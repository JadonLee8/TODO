/**
 * Turns what another app shares (Android's share sheet: an optional subject plus text) into a task's title and notes.
 * Browsers share the page title as the subject and the URL as the text; other apps usually share text only, sometimes
 * a title line followed by a link.
 */

export interface SharedText {
  subject?: string | null
  text?: string | null
}

export interface SharedTask {
  title: string
  notes: string
}

/** Longest title kept; the full text is always in the notes. */
const MAX_TITLE = 160

const URL_ONLY = /^https?:\/\/\S+$/i

export function sharedTextToTask(shared: SharedText): SharedTask | null {
  const subject = clean(shared.subject)
  const text = (shared.text ?? '').replace(/\r\n?/g, '\n').trim()
  if (!subject && !text) return null

  if (subject) return { title: truncate(subject), notes: text === subject ? '' : text }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // A title line plus a link (what many apps share): the title line names the task, everything goes in the notes.
  const titleLine = lines.find((l) => !URL_ONLY.test(l)) ?? lines[0]
  const title = truncate(clean(titleLine))
  return { title, notes: text === title ? '' : text }
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function truncate(value: string): string {
  return value.length > MAX_TITLE ? `${value.slice(0, MAX_TITLE - 1).trimEnd()}…` : value
}
