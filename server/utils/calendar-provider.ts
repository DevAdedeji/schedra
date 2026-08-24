export interface CalendarEventInput {
  uid: string
  title: string
  description?: string | null
  startsAt: Date
  endsAt: Date
  attendeeName: string
  attendeeEmail: string
  additionalGuestEmails: string[]
  notes?: string | null
  locationType: 'google_meet' | 'video_link' | 'phone' | 'in_person' | 'custom'
  locationDetails: string
  meetingUrl?: string | null
}

export interface CalendarProviderConnection {
  id: string
  provider: string
  writeCalendarId: string | null
}

export interface CalendarRemoteEvent {
  id: string
  meetingUrl: string | null
}

export interface BusyPeriod {
  start: string
  end: string
}

export interface CalendarProvider {
  id: string
  busyTimes(userId: string, from: string, to: string): Promise<BusyPeriod[]>
  connectionFor(userId: string): Promise<CalendarProviderConnection | null>
  eventId(uid: string): string
  upsertEvent(userId: string, calendarId: string, eventId: string | null, input: CalendarEventInput): Promise<CalendarRemoteEvent>
  deleteEvent(userId: string, calendarId: string, eventId: string): Promise<void>
}
