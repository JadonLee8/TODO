import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ExtensionId, ExtensionRunResult } from '@shared/types'
import * as cache from '../localCache'
import { googleCalendarExtension } from './googleCalendar/import'
import { obsidianExtension } from './obsidian'
import { microsoftTodoExtension } from './microsoftTodo'
import type { MainExtension, StepResult } from './types'

/** Every built-in extension's main-process half. The catalog shown in the marketplace is shared/extensions.ts. */
const EXTENSIONS: MainExtension[] = [googleCalendarExtension, microsoftTodoExtension, obsidianExtension]

/** Installed (a synced setting) and set up on this device. */
export function activeExtensions(): MainExtension[] {
  const settings = cache.getSettings()
  return EXTENSIONS.filter((e) => settings.extensions.installed.includes(e.id) && e.isReady(settings))
}

// ---- Last result of each extension on this device, for the marketplace's status lines ----

function runsPath(): string {
  return join(app.getPath('userData'), 'extension-runs.json')
}

export function getLastRuns(): Partial<Record<ExtensionId, ExtensionRunResult>> {
  try {
    return existsSync(runsPath()) ? (JSON.parse(readFileSync(runsPath(), 'utf8')) as Partial<Record<ExtensionId, ExtensionRunResult>>) : {}
  } catch {
    return {}
  }
}

function saveRuns(results: ExtensionRunResult[]): void {
  if (!results.length) return
  const runs = getLastRuns()
  for (const r of results) runs[r.extensionId] = r
  writeFileSync(runsPath(), JSON.stringify(runs, null, 2))
}

// ---- Running ----

type Phase = 'importTasks' | 'exportTasks'

/** Runs one phase of each extension. Never throws: a failing extension reports its error and the others still run. */
export async function runPhase(extensions: MainExtension[], phase: Phase, now: Date = new Date()): Promise<ExtensionRunResult[]> {
  const results: ExtensionRunResult[] = []
  for (const ext of extensions) {
    const step = ext[phase]
    if (!step) continue
    results.push(await runStep(ext.id, () => step.call(ext, now), now))
  }
  return results
}

async function runStep(id: ExtensionId, step: () => Promise<StepResult>, now: Date): Promise<ExtensionRunResult> {
  try {
    const { summary, changedTasks } = await step()
    return { extensionId: id, at: now.toISOString(), summary, changedTasks, error: null }
  } catch (err) {
    return { extensionId: id, at: now.toISOString(), summary: '', changedTasks: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Joins each extension's import and export results into one line per extension, and remembers them. */
export function combineAndSave(results: ExtensionRunResult[]): ExtensionRunResult[] {
  const byId = new Map<ExtensionId, ExtensionRunResult>()
  for (const r of results) {
    const prev = byId.get(r.extensionId)
    byId.set(
      r.extensionId,
      prev
        ? {
            ...r,
            summary: [prev.summary, r.summary].filter(Boolean).join('. '),
            changedTasks: prev.changedTasks + r.changedTasks,
            error: [prev.error, r.error].filter(Boolean).join('; ') || null
          }
        : r
    )
  }
  const combined = [...byId.values()]
  saveRuns(combined)
  return combined
}

/** "Run now" from the marketplace: one extension's import and export, without syncing. Imports push on the next Sync. */
export async function runExtensionNow(id: ExtensionId): Promise<ExtensionRunResult> {
  const now = new Date()
  const ext = EXTENSIONS.find((e) => e.id === id)
  const settings = cache.getSettings()
  if (!ext || !settings.extensions.installed.includes(id)) {
    return combineAndSave([{ extensionId: id, at: now.toISOString(), summary: '', changedTasks: 0, error: 'Not installed' }])[0]
  }
  if (!ext.isReady(settings)) {
    return combineAndSave([{ extensionId: id, at: now.toISOString(), summary: '', changedTasks: 0, error: 'Not set up on this device yet' }])[0]
  }
  const results = [...(await runPhase([ext], 'importTasks', now)), ...(await runPhase([ext], 'exportTasks', now))]
  return combineAndSave(results)[0]
}
