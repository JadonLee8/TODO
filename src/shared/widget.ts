import type { SyncedSettings, Task } from './types'
import { MAIN_LIST_ID } from './types'
import { rankTasks } from './ranking'
import { resolveTheme, themeColors } from './themes'
import { resolveFont } from './fonts'
import { fontForStyle, resolveStyle, type StyleId } from './styles'
import { localDateString, shortDueDate } from './calendar'

/**
 * What the Android home-screen widget shows: the top of the ranked Tasks list, in the current theme, font and style. The app
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
  /** The terminal style draws the widget as a shell listing (square corners, `[ ] p1 title` rows, a prompt as the title). */
  style: StyleId
  /** The Android system font family closest to the app's font (widgets can't use the bundled fonts). */
  fontFamily: string
  colors: {
    background: string
    text: string
    muted: string
    accent: string
    danger: string
    /** The terminal style's prompt color. */
    ok: string
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
  const style = resolveStyle(settings.appearance.styleId)
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
          due: t.dueDate ? shortDueDate(t.dueDate, now) : null,
          overdue: dueDay !== null && dueDay < today
        }
      }),
    style: style.id,
    fontFamily: fontForStyle(style, resolveFont(settings.appearance.fontId)).androidFamily,
    colors: {
      // The terminal style sits on the page color itself, like the app's terminal.
      background: style.id === 'terminal' ? colors.paper : colors.paperRaised,
      text: colors.ink,
      muted: colors.slate,
      accent: colors.highlighter,
      danger: colors.danger,
      ok: colors.ok
    }
  }
}
