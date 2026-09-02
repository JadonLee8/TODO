import type { Priority } from '@shared/types'
import { PRIORITY_COLORS, PRIORITY_LABELS, PRIORITIES } from '../priorityUi'

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <div className="priority-picker">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          className={`priority-chip${value === p ? ' selected' : ''}`}
          style={value === p ? { background: PRIORITY_COLORS[p] } : undefined}
          onClick={() => onChange(p)}
        >
          {PRIORITY_LABELS[p]}
        </button>
      ))}
    </div>
  )
}
