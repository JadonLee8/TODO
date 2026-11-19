import type { SyncedSettings, Task } from './types'
import { MAIN_LIST_ID } from './types'
import { rankTasks } from './ranking'
import { resolveTheme, themeColors } from './themes'
import { localDateString } from './calendar'

/**
 * What the Android home-screen widget shows: the top of the ranked Tasks list, in the current theme's colors. The app
 * hands a fresh snapshot to the widget after every change; the widget itself never reads tasks or syncs.
 */

export interface WidgetTask {
  id: string
  title: string
  priority: number
  starred: boolean
  /** Short due date ("Nov 20"), or null. */
  due: string | null
  overdue: boolean
}

export interface WidgetSnapshot {
  /** Open tasks in the Tasks list (the widget shows the first few). */
  openCount: number
  tasks: WidgetTask[]
  colors: {
    background: string
    text: string
    muted: string
    accent: string
    danger: string
  }
}

/** What a tap on the widget asks the app to do. */
export type WidgetAction = { kind: 'task'; taskId: string } | { kind: 'add' }

/** More than fit on a large widget; the native side shows as many as it has rows for. */
export const WIDGET_TASK_LIMIT = 8

export function widgetSnapshot(tasks: Task[], settings: SyncedSettings, now: Date = new Date()): WidgetSnapshot {
  const open = tasks.filter((t) => t.listId === MAIN_LIST_ID && !t.completed && !t.archived)
  const today = localDateString(now)
  const colors = themeColors(resolveTheme(settings.appearance))
  return {
    openCount: open.length,
    tasks: rankTasks(open, settings.ranking, now)
      .slice(0, WIDGET_TASK_LIMIT)
      .map((t) => {
        const dueDay = t.dueDate?.slice(0, 10) ?? null
        return {
          id: t.id,
          title: t.title,
          priority: t.priority,
          starred: t.starred,
          due: t.dueDate ? shortDate(t.dueDate, now) : null,
          overdue: dueDay !== null && dueDay < today
        }
      }),
    colors: { background: colors.paperRaised, text: colors.ink, muted: colors.slate, accent: colors.highlighter, danger: colors.danger }
  }
}

/** Due dates are stored as midnight UTC of the due day, so format the UTC date. Year only when it isn't this year. */
function shortDate(iso: string, now: Date): string {
  const date = new Date(iso)
  const thisYear = date.getUTCFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) })
}
