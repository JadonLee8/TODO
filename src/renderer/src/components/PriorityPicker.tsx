import type { Priority } from '@shared/types'
import { PRIORITY_LABELS, PRIORITIES } from '../priorityUi'

/** Each choice is set in the same weight and size its tasks get in the list. */
export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <div className="priority-picker" role="radiogroup" aria-label="Priority">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          className={`priority-chip p${p}${value === p ? ' selected' : ''}`}
          onClick={() => onChange(p)}
        >
          {PRIORITY_LABELS[p]}
        </button>
      ))}
    </div>
  )
}
