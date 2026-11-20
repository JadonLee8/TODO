import { describe, expect, it } from 'vitest'
import { WIDGET_TASK_LIMIT, widgetSnapshot } from './widget'
import { DEFAULT_SYNCED_SETTINGS, MAIN_LIST_ID, type Priority, type Task } from './types'
import { resolveTheme, themeColors } from './themes'

const NOW = new Date(2026, 10, 17, 12) // Nov 17 2026, local noon

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    listId: MAIN_LIST_ID,
    title: `Task ${id}`,
    notes: '',
    priority: 3,
    starred: false,
    completed: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    archived: false,
    dueDate: null,
    source: null,
    ...over
  }
}

describe('widgetSnapshot', () => {
  it('shows the ranked open tasks of the Tasks list only', () => {
    const snapshot = widgetSnapshot(
      [
        task('low', { priority: 5 }),
        task('urgent', { priority: 1 }),
        task('done', { completed: true }),
        task('archived', { archived: true }),
        task('other-list', { listId: 'groceries' })
      ],
      DEFAULT_SYNCED_SETTINGS,
      NOW
    )
    expect(snapshot.openCount).toBe(2)
    expect(snapshot.tasks.map((t) => t.id)).toEqual(['urgent', 'low'])
  })

  it('keeps at most a widget’s worth of tasks but counts them all', () => {
    const many = Array.from({ length: 20 }, (_, i) => task(String(i), { priority: ((i % 5) + 1) as Priority }))
    const snapshot = widgetSnapshot(many, DEFAULT_SYNCED_SETTINGS, NOW)
    expect(snapshot.tasks).toHaveLength(WIDGET_TASK_LIMIT)
    expect(snapshot.openCount).toBe(20)
  })

  it('labels due dates and flags overdue ones', () => {
    const snapshot = widgetSnapshot(
      [
        task('late', { dueDate: '2026-11-10T00:00:00.000Z' }),
        task('today', { dueDate: '2026-11-17T00:00:00.000Z' }),
        task('next-year', { dueDate: '2027-01-05T00:00:00.000Z' })
      ],
      DEFAULT_SYNCED_SETTINGS,
      NOW
    )
    const byId = Object.fromEntries(snapshot.tasks.map((t) => [t.id, t]))
    expect(byId.late).toMatchObject({ due: 'Nov 10', overdue: true })
    expect(byId.today).toMatchObject({ due: 'Nov 17', overdue: false })
    expect(byId['next-year']).toMatchObject({ due: 'Jan 5, 2027', overdue: false })
  })

  it('uses the current theme’s colors', () => {
    const settings = { ...DEFAULT_SYNCED_SETTINGS, appearance: { ...DEFAULT_SYNCED_SETTINGS.appearance, themeId: 'night' } }
    const colors = themeColors(resolveTheme(settings.appearance))
    expect(widgetSnapshot([], settings, NOW).colors).toEqual({
      background: colors.paperRaised,
      text: colors.ink,
      muted: colors.slate,
      accent: colors.highlighter,
      danger: colors.danger,
      ok: colors.ok
    })
  })

  it('carries the style and the closest Android font', () => {
    const appearance = DEFAULT_SYNCED_SETTINGS.appearance
    const standard = widgetSnapshot([], DEFAULT_SYNCED_SETTINGS, NOW)
    expect(standard).toMatchObject({ style: 'standard', fontFamily: 'sans-serif-condensed' })

    const mono = widgetSnapshot([], { ...DEFAULT_SYNCED_SETTINGS, appearance: { ...appearance, fontId: 'mono' } }, NOW)
    expect(mono).toMatchObject({ style: 'standard', fontFamily: 'monospace' })

    // The terminal style is always monospace, and sits on the page color.
    const terminal = widgetSnapshot([], { ...DEFAULT_SYNCED_SETTINGS, appearance: { ...appearance, styleId: 'terminal' } }, NOW)
    expect(terminal).toMatchObject({ style: 'terminal', fontFamily: 'monospace' })
    expect(terminal.colors.background).toBe(themeColors(resolveTheme(appearance)).paper)
  })
})
