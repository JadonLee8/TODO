import { createHash } from 'crypto'

/**
 * A UUID-shaped id derived from (calendarId, eventId), so two devices importing the same event write the
 * same task file instead of creating duplicates. Formatted as an RFC 9562 version 8 (custom) UUID.
 */
export function calendarTaskId(calendarId: string, eventId: string): string {
  const hex = createHash('sha256').update(`${calendarId}\n${eventId}`).digest('hex').slice(0, 32).split('')
  hex[12] = '8'
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
