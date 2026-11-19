import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GoogleCalendarInfo } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { eventToTask, localDateString, tasksToPromote, type GoogleCalendarEvent } from '@shared/calendar'
import { calendarTaskId } from './ids'
import { getAccessToken, googleEndpoints } from './auth'
import * as cache from '../../localCache'
import * as secureStore from '../../secureStore'
import type { MainExtension, StepResult } from '../types'

/**
 * Imports Google Calendar events as tasks. Each event is imported once: a per-device ledger remembers every
 * task id this device has imported, so a task you edit or delete is never recreated or overwritten. Changes to
 * an event after import (new time, cancellation) are not carried over.
 */

interface Ledger {
  importedTaskIds: string[]
  /** Imported tasks this device has already bumped to P1 for being overdue. */
  promotedTaskIds: string[]
}

function ledgerPath(): string {
  return join(app.getPath('userData'), 'calendar-ledger.json')
}

function loadLedger(): Ledger {
  const empty: Ledger = { importedTaskIds: [], promotedTaskIds: [] }
  return existsSync(ledgerPath()) ? { ...empty, ...(JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Partial<Ledger>) } : empty
}

function saveLedger(ledger: Ledger): void {
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2))
}


async function googleGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${googleEndpoints().api}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(`Google Calendar request failed (${res.status})${body?.error?.message ? `: ${body.error.message}` : ''}`)
  }
  return (await res.json()) as T
}

export async function listCalendars(): Promise<GoogleCalendarInfo[]> {
  const data = await googleGet<{
    items?: Array<{ id: string; summary: string; summaryOverride?: string; primary?: boolean; backgroundColor?: string }>
  }>('/users/me/calendarList', { minAccessRole: 'reader' })
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride ?? c.summary,
    primary: !!c.primary,
    backgroundColor: c.backgroundColor
  }))
}

async function fetchEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<GoogleCalendarEvent[]> {
  const events: GoogleCalendarEvent[] = []
  let pageToken: string | undefined
  do {
    const page = await googleGet<{ items?: GoogleCalendarEvent[]; nextPageToken?: string }>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: '250',
        ...(pageToken ? { pageToken } : {})
      }
    )
    events.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)
  return events
}

/**
 * Imports new events from the selected calendars (start of today through `daysAhead` days) and promotes overdue
 * imported tasks to P1. Writes go to the local cache and are queued for the next push.
 */
async function importEvents(now: Date): Promise<StepResult> {
  const ledger = loadLedger()
  let imported = 0
  let promoted = 0
  const settings = cache.getSettings().extensions.googleCalendar
  const importedIds = new Set(ledger.importedTaskIds)
  // Fall back to the main list if the target list was deleted.
  const targetListId = cache.getLists().some((l) => l.id === settings.targetListId) ? settings.targetListId : MAIN_LIST_ID

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + settings.daysAhead + 1)

  try {
    for (const calendarId of settings.calendarIds) {
      for (const event of await fetchEvents(calendarId, start, end)) {
        if (event.status === 'cancelled') continue
        const id = calendarTaskId(calendarId, event.id)
        if (importedIds.has(id)) continue
        importedIds.add(id)
        // Another device may already have imported it; sync pulls before importing, so it's in the cache.
        if (cache.getTask(id)) continue
        cache.writeTaskLocal(eventToTask(event, calendarId, id, { targetListId, defaultPriority: settings.defaultPriority }, now))
        cache.markTaskDirty(id)
        imported++
      }
    }
  } finally {
    // Keep what was imported before a failure, so it isn't imported again.
    ledger.importedTaskIds = [...importedIds]
    saveLedger(ledger)
  }

  if (settings.promoteOverdue) {
    const promotedIds = new Set(ledger.promotedTaskIds)
    for (const task of tasksToPromote(cache.getAllTasks(), localDateString(now), promotedIds)) {
      cache.writeTaskLocal({ ...task, priority: 1, updatedAt: now.toISOString() })
      cache.markTaskDirty(task.id)
      promotedIds.add(task.id)
      promoted++
    }
    ledger.promotedTaskIds = [...promotedIds]
    saveLedger(ledger)
  }

  const parts = [imported ? `Imported ${imported} event${imported === 1 ? '' : 's'}` : 'No new events']
  if (promoted) parts.push(`${promoted} overdue task${promoted === 1 ? '' : 's'} moved to P1`)
  return { summary: parts.join(', '), changedTasks: imported + promoted }
}

export const googleCalendarExtension: MainExtension = {
  id: 'google-calendar',
  // Runs on devices connected to Google, once at least one calendar is selected.
  isReady: (settings) => secureStore.loadLocalSettings().googleConnected && settings.extensions.googleCalendar.calendarIds.length > 0,
  importTasks: importEvents
}
