import { describe, expect, it } from 'vitest'
import { calendarTaskId } from './ids'

describe('calendarTaskId', () => {
  it('is deterministic and UUID-shaped', () => {
    const id = calendarTaskId('me@example.com', 'abc123')
    expect(id).toBe(calendarTaskId('me@example.com', 'abc123'))
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('differs per calendar and per event', () => {
    const id = calendarTaskId('a', 'b')
    expect(calendarTaskId('a', 'c')).not.toBe(id)
    expect(calendarTaskId('b', 'b')).not.toBe(id)
    // The separator keeps ("ab", "c") and ("a", "bc") apart.
    expect(calendarTaskId('ab', 'c')).not.toBe(calendarTaskId('a', 'bc'))
  })
})
