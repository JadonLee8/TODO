import type { Task } from './types'
import { localDateString } from './calendar'

/** One day of the burndown, in the device's local time zone. */
export interface DayPoint {
  /** YYYY-MM-DD */
  day: string
  /** Tasks still open at the end of the day. */
  open: number
  created: number
  completed: number
}

/**
 * Open tasks at the end of each of the last `days` days (today included), with how many were created and completed
 * that day. Built from each task's createdAt and completedAt, so deleted tasks don't count anywhere, and a task
 * completed and then reopened counts as open throughout.
 */
export function burndown(tasks: Task[], days: number, now: Date = new Date()): DayPoint[] {
  const dayOf = (iso: string) => localDateString(new Date(iso))
  const points: DayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    points.push({ day: localDateString(d), open: 0, created: 0, completed: 0 })
  }
  const index = new Map(points.map((p, i) => [p.day, i]))
  const first = points[0].day

  for (const task of tasks) {
    const created = dayOf(task.createdAt)
    const done = task.completed && task.completedAt ? dayOf(task.completedAt) : null
    const ci = index.get(created)
    if (ci !== undefined) points[ci].created++
    if (done) {
      const di = index.get(done)
      if (di !== undefined) points[di].completed++
    }
    // Open from its creation day (or the window's start) up to, but not including, its completion day.
    for (let i = created < first ? 0 : ci ?? points.length; i < points.length; i++) {
      if (done && points[i].day >= done) break
      points[i].open++
    }
  }
  return points
}

export interface Totals {
  open: number
  overdue: number
  createdLast7: number
  completedLast7: number
}

export function totals(tasks: Task[], now: Date = new Date()): Totals {
  const today = localDateString(now)
  const weekAgo = localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  const inWeek = (iso: string | null) => !!iso && localDateString(new Date(iso)) >= weekAgo
  const open = tasks.filter((t) => !t.completed)
  return {
    open: open.length,
    overdue: open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today).length,
    createdLast7: tasks.filter((t) => inWeek(t.createdAt)).length,
    completedLast7: tasks.filter((t) => t.completed && inWeek(t.completedAt)).length
  }
}
