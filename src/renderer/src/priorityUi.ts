import type { Priority } from '@shared/types'

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
  5: 'P5'
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  1: 'var(--p1)',
  2: 'var(--p2)',
  3: 'var(--p3)',
  4: 'var(--p4)',
  5: 'var(--p5)'
}

export const PRIORITIES: Priority[] = [1, 2, 3, 4, 5]
