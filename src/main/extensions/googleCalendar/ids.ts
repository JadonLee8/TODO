import { stableUuid } from '../stableId'

/** The task id for a calendar event: the same on every device, so two devices importing it write one file. */
export function calendarTaskId(calendarId: string, eventId: string): string {
  return stableUuid(calendarId, eventId)
}
