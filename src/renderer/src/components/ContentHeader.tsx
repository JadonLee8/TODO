import type { ReactNode } from 'react'

/** The main pane's header: title, a summary line, an optional status line, and actions on the right. */
export function ContentHeader({ title, summary, status, actions }: { title: string; summary?: string; status?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="content-header">
      <div className="header-text">
        <h1>{title}</h1>
        {summary && <p className="header-summary">{summary}</p>}
        {status}
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  )
}
