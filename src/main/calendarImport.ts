import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CalendarImportResult, GoogleCalendarInfo } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { eventToTask, localDateString, tasksToPromote, type GoogleCalendarEvent } from '@shared/calendar'
import { calendarTaskId } from './calendarIds'
import { getAccessToken, googleEndpoints } from './googleAuth'
import * as cache from './localCache'
import * as secureStore from './secureStore'

/**
 * Imports Google Calendar events as tasks. Each event is imported once: a per-device ledger remembers every
 * task id this device has imported, so a task you edit or delete is never recreated or overwritten. Changes to
 * an event after import (new time, cancellation) are not carried over.
 */

interface Ledger {
  importedTaskIds: string[]
  /** Imported tasks this device has already bumped to P1 for being overdue. */
  promotedTaskIds: string[]
  lastImport: CalendarImportResult | null
}

function ledgerPath(): string {
  return join(app.getPath('userData'), 'calendar-ledger.json')
}

function loadLedger(): Ledger {
  const empty: Ledger = { importedTaskIds: [], promotedTaskIds: [], lastImport: null }
  return existsSync(ledgerPath()) ? { ...empty, ...(JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Partial<Ledger>) } : empty
}

function saveLedger(ledger: Ledger): void {
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2))
}

export function getLastImport(): CalendarImportResult | null {
  return loadLedger().lastImport
}

/** Whether this device should run imports: connected, with at least one calendar selected. */
export function calendarImportEnabled(): boolean {
  return secureStore.loadLocalSettings().googleConnected && cache.getSettings().calendar.calendarIds.length > 0
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
 * imported tasks to P1. Writes go to the local cache and are queued for the next push. Never throws: failures are
 * reported in the result.
 */
export async function runCalendarImport(now: Date = new Date()): Promise<CalendarImportResult> {
  const ledger = loadLedger()
  const result: CalendarImportResult = { at: now.toISOString(), imported: 0, promoted: 0, error: null }
  try {
    const settings = cache.getSettings().calendar
    const importedIds = new Set(ledger.importedTaskIds)
    // Fall back to the main list if the target list was deleted.
    const targetListId = cache.getLists().some((l) => l.id === settings.targetListId) ? settings.targetListId : MAIN_LIST_ID

    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start)
    end.setDate(end.getDate() + settings.daysAhead + 1)

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
        result.imported++
      }
    }
    ledger.importedTaskIds = [...importedIds]

    if (settings.promoteOverdue) {
      const promotedIds = new Set(ledger.promotedTaskIds)
      for (const task of tasksToPromote(cache.getAllTasks(), localDateString(now), promotedIds)) {
        cache.writeTaskLocal({ ...task, priority: 1, updatedAt: now.toISOString() })
        cache.markTaskDirty(task.id)
        promotedIds.add(task.id)
        result.promoted++
      }
      ledger.promotedTaskIds = [...promotedIds]
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  ledger.lastImport = result
  saveLedger(ledger)
  return result
}
