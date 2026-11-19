import { createHash } from 'crypto'

/**
 * A UUID-shaped id derived from `parts`, so two devices importing the same outside item (a calendar event, a
 * Microsoft To Do task) write the same file instead of creating duplicates. Formatted as an RFC 9562 version 8
 * (custom) UUID.
 */
export function stableUuid(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32).split('')
  hex[12] = '8'
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
