import type { PaginationMeta } from '#shared/pagination'
import type { EventTypeInput, MeetingLocationType } from '#shared/validation'
import type { EventTypeRecord } from '~/types/event-type'
import type { ScheduleOverrideRecord, ScheduleRecord, ScheduleRuleRecord } from '~/types/schedule'

export interface BookingRecord {
  uid: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'rejected'
  startsAt: string
  endsAt: string
  attendeeName: string
  attendeeEmail: string
  attendeeTimeZone: string
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl: string | null
  eventTitle: string
  notes: string | null
  cancellationReason: string | null
}

export interface BookingDetail {
  uid: string
  status: BookingRecord['status']
  startsAt: string
  endsAt: string
  attendeeName: string
  attendeeEmail: string
  attendeeTimeZone: string
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl: string | null
  cancellationReason: string | null
  eventTitle: string
  eventSlug: string
  durationMinutes: number
  hostName: string
  hostUsername: string
}

export interface CreateBookingResult {
  start: string
  uid: string
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl: string | null
}

export interface BookingsResponse {
  items: BookingRecord[]
  pagination: PaginationMeta
  counts: { all: number, upcoming: number, past: number, cancelled: number, nextWeek: number }
}

export interface EventTypesResponse {
  items: EventTypeRecord[]
  pagination: PaginationMeta
  counts: { all: number, active: number, hidden: number }
}

export interface SchedulesResponse {
  items: ScheduleRecord[]
  pagination: PaginationMeta
  counts: { all: number, default: number }
}

export interface CalendarConnection {
  connected: boolean
  configured: boolean
  status?: 'active' | 'needs_reauthorization' | 'disconnected'
  accountLabel?: string | null
  conflictCalendarIds?: string[]
  writeCalendarId?: string | null
  lastError?: string | null
}

export interface CalendarItem {
  id: string
  summary: string
  primary: boolean
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
  backgroundColor?: string
  unavailable?: boolean
}

export interface CalendarsResponse {
  items: CalendarItem[]
  conflictCalendarIds: string[]
  writeCalendarId: string | null
}

export interface PublicProfile {
  name: string
  username: string
  bio: string | null
  avatarUrl: string | null
  eventTypes: Array<{
    slug: string
    title: string
    description: string | null
    durationMinutes: number
  }>
}

export interface PublicBookingPage {
  hostName: string
  title: string
  description: string | null
  durationMinutes: number
  locationType: MeetingLocationType
  locationDetails: string
}

export interface AvailabilityResponse {
  timeZone: string
  durationMinutes: number
  slots: Array<{ start: string, end: string }>
}

export interface CreateBookingInput {
  username: string
  slug: string
  start: string
  name: string
  email: string
  timeZone: string
  notes?: string
  rescheduleOf?: string
}

export interface ScheduleUpdateInput {
  name: string
  timeZone: string
  isDefault: boolean
  rules: ScheduleRuleRecord[]
  overrides: ScheduleOverrideRecord[]
}

function resource(path: string, id: string, suffix = '') {
  return `${path}/${encodeURIComponent(id)}${suffix}`
}

export function apiErrorMessage(failure: unknown, fallback: string) {
  const error = failure as {
    data?: { statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return error.data?.statusMessage ?? error.statusMessage ?? fallback
}

export const bookingsApi = {
  listEndpoint: '/api/bookings' as const,
  detailEndpoint: (uid: string) => resource('/api/booking', uid),
  get: (uid: string) => $fetch<BookingDetail>(resource('/api/booking', uid)),
  create: (body: CreateBookingInput) => $fetch<CreateBookingResult>('/api/bookings', { method: 'POST', body }),
  cancel: (uid: string, reason?: string) => $fetch(resource('/api/booking', uid, '/cancel'), {
    method: 'POST',
    body: { reason }
  })
}

export const eventTypesApi = {
  listEndpoint: '/api/event-types' as const,
  create: (body: EventTypeInput) => $fetch('/api/event-types', { method: 'POST', body }),
  update: (id: string, body: EventTypeInput) => $fetch(resource('/api/event-types', id), { method: 'PATCH', body }),
  remove: (id: string) => $fetch(resource('/api/event-types', id), { method: 'DELETE' })
}

export const schedulesApi = {
  listEndpoint: '/api/schedules' as const,
  create: (body: { name: string, timeZone: string }) => $fetch<{ id: string }>('/api/schedules', { method: 'POST', body }),
  duplicate: (id: string) => $fetch<{ id: string }>(resource('/api/schedules', id, '/duplicate'), { method: 'POST' }),
  update: (id: string, body: ScheduleUpdateInput) => $fetch(resource('/api/schedules', id), { method: 'PATCH', body }),
  remove: (id: string) => $fetch(resource('/api/schedules', id), { method: 'DELETE' })
}

export const profileApi = {
  update: (body: { name: string, bio?: string }) => $fetch('/api/profile', { method: 'PATCH', body })
}

export const calendarApi = {
  connectionEndpoint: '/api/integrations/google-calendar' as const,
  calendars: () => $fetch<CalendarsResponse>('/api/integrations/google-calendar/calendars'),
  update: (body: { conflictCalendarIds: string[], writeCalendarId: string }) => $fetch('/api/integrations/google-calendar', { method: 'PATCH', body }),
  disconnect: () => $fetch('/api/integrations/google-calendar', { method: 'DELETE' })
}

export const publicBookingApi = {
  profileEndpoint: (username: string) => resource('/api/profile', username),
  pageEndpoint: (username: string, slug: string) => resource(resource('/api/booking-page', username), slug),
  availabilityEndpoint: '/api/availability' as const
}
