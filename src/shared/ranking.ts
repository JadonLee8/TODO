import type { RankingSettings, Task } from './types'

/**
 * Orders active (non-completed) tasks for the main task view:
 *  - P1 tasks always come first, oldest first.
 *  - P2/P3 tasks are interleaved by a blended age/priority score (see RankingSettings.midPriorityWeight).
 *  - P4 tasks always come before P5 tasks.
 *  - Within P1, P4, and P5, ties are broken by age (oldest first).
 *  - With settings.starredFirst, starred tasks move to the top of their own tier (P1 still always comes first).
 */
export function rankTasks(tasks: Task[], settings: RankingSettings, now: Date = new Date()): Task[] {
  const tier1 = tasks.filter((t) => t.priority === 1)
  const tier23 = tasks.filter((t) => t.priority === 2 || t.priority === 3)
  const tier4 = tasks.filter((t) => t.priority === 4)
  const tier5 = tasks.filter((t) => t.priority === 5)

  const byAgeOldestFirst = (a: Task, b: Task) => ageDays(a, now) - ageDays(b, now)

  tier1.sort((a, b) => byAgeOldestFirst(b, a)) // oldest (largest age) first
  tier4.sort((a, b) => byAgeOldestFirst(b, a))
  tier5.sort((a, b) => byAgeOldestFirst(b, a))

  tier23.sort((a, b) => blendedScore(b, settings, now) - blendedScore(a, settings, now))

  const tiers = [tier1, tier23, tier4, tier5]
  return tiers.flatMap((tier) => (settings.starredFirst ? starredToTop(tier) : tier))
}

/** Orders active tasks for lists other than the main one: oldest first, optionally with starred tasks on top. */
export function orderPlainList(tasks: Task[], settings: Pick<RankingSettings, 'starredFirst'>): Task[] {
  const byCreated = [...tasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return settings.starredFirst ? starredToTop(byCreated) : byCreated
}

/** Stable partition: starred tasks first, each group keeping its existing order. */
function starredToTop(tasks: Task[]): Task[] {
  return [...tasks.filter((t) => t.starred), ...tasks.filter((t) => !t.starred)]
}

function ageDays(task: Task, now: Date): number {
  const created = new Date(task.createdAt).getTime()
  return (now.getTime() - created) / (1000 * 60 * 60 * 24)
}

/** Higher score = higher in the list. Priority factor: P2 = 1, P3 = 0. */
function blendedScore(task: Task, settings: RankingSettings, now: Date): number {
  const priorityFactor = task.priority === 2 ? 1 : 0
  const normalizedAge = clamp(ageDays(task, now) / Math.max(settings.ageNormalizationDays, 1), 0, 1)
  const weight = clamp(settings.midPriorityWeight, 0, 1)
  return weight * priorityFactor + (1 - weight) * normalizedAge
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
