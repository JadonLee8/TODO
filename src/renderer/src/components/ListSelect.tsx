import { useMemo } from 'react'
import { MAIN_LIST_ID } from '@shared/types'
import { buildSidebarTree } from '@shared/sidebarTree'
import { useAppState } from '../state/AppStateContext'

/** A dropdown of every list, in sidebar order, with folders as groups. `allLabel` adds a first option whose value is ''. */
export function ListSelect({ value, onChange, allLabel }: { value: string; onChange: (listId: string) => void; allLabel?: string }) {
  const { lists, folders } = useAppState()
  const tree = useMemo(() => buildSidebarTree(lists, folders), [lists, folders])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={allLabel ? 'List' : undefined}>
      {allLabel && <option value="">{allLabel}</option>}
      <option value={MAIN_LIST_ID}>Tasks</option>
      {tree.map((entry) =>
        entry.kind === 'list' ? (
          <option key={entry.list.id} value={entry.list.id}>
            {entry.list.name}
          </option>
        ) : (
          entry.lists.length > 0 && (
            <optgroup key={entry.folder.id} label={entry.folder.name}>
              {entry.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          )
        )
      )}
    </select>
  )
}
