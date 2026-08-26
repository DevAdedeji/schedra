import type { PaginationMeta } from '#shared/pagination'
import type { InvitableRole, OrganizationEntitlement, OrganizationRole } from '#shared/billing'
import type { BookingAnswer, BookingQuestion, EventTypeInput, MeetingLocationType } from '#shared/validation'
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
  additionalGuestEmails: string[]
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
  additionalGuestEmails: string[]
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl: string | null
  cancellationReason: string | null
  eventTitle: string
  eventSlug: string
  durationMinutes: number
  hostName: string
  hostUsername: string
  notes: string | null
  answers: BookingAnswer[]
  canHostManage: boolean
}

export interface CreateBookingResult {
  start: string
  uid: string
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl: string | null
  status: BookingRecord['status']
}

export interface BookingsResponse {
  items: BookingRecord[]
  pagination: PaginationMeta
  counts: { all: number, upcoming: number, pending: number, past: number, cancelled: number, nextWeek: number }
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

export interface CurrentProfile {
  id: string
  name: string
  email: string
  emailVerified: boolean
  username: string
  bio: string | null
  avatarUrl: string | null
  timeZone: string
}

export interface PublicBookingPage {
  hostName: string
  title: string
  description: string | null
  durationMinutes: number
  locationType: MeetingLocationType
  locationDetails: string
  bookingQuestions: BookingQuestion[]
  requiresConfirmation: boolean
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
  answers?: Record<string, string>
  guestEmails?: string[]
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
  }),
  approve: (uid: string) => $fetch(resource('/api/booking', uid, '/approve'), { method: 'POST' }),
  reject: (uid: string, reason?: string) => $fetch(resource('/api/booking', uid, '/reject'), {
    method: 'POST',
    body: { reason }
  })
}

export const eventTypesApi = {
  listEndpoint: '/api/event-types' as const,
  create: (body: EventTypeInput) => $fetch('/api/event-types', { method: 'POST', body }),
  duplicate: (id: string) => $fetch<{ id: string }>(resource('/api/event-types', id, '/duplicate'), { method: 'POST' }),
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
  update: (body: { name: string, bio?: string }) => $fetch<{ user: CurrentProfile }>('/api/profile', { method: 'PATCH', body }),
  uploadAvatar: (file: File) => {
    const body = new FormData()
    body.append('avatar', file)
    return $fetch<{ avatarUrl: string }>('/api/profile/avatar', { method: 'PUT', body })
  },
  removeAvatar: () => $fetch('/api/profile/avatar', { method: 'DELETE' })
}

export const accountApi = {
  exportUrl: '/api/account/export' as const,
  remove: (body: { email: string, confirmation: 'DELETE' }) => $fetch('/api/account', { method: 'DELETE', body })
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

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  logo: string | null
  role: OrganizationRole
  joinedAt: string
  entitlement: OrganizationEntitlement
}

export interface WorkspacePermissions {
  inviteMembers: boolean
  removeMembers: boolean
  changeRoles: boolean
  updateWorkspace: boolean
  changeAddress: boolean
  transferOwnership: boolean
  manageBilling: boolean
  archiveWorkspace: boolean
  manageEventTypes: boolean
  viewAllBookings: boolean
}

export interface WorkspaceDetail {
  organization: { id: string, name: string, slug: string, logo: string | null, archived: boolean }
  role: OrganizationRole
  entitlement: OrganizationEntitlement
  permissions: WorkspacePermissions
}

export interface WorkspaceMemberRecord {
  id: string
  userId: string
  role: OrganizationRole
  joinedAt: string
  name: string
  email: string
  username: string
  avatarUrl: string | null
  timeZone: string
  isYou: boolean
}

export interface WorkspaceMembersResponse {
  items: WorkspaceMemberRecord[]
  pagination: PaginationMeta
  counts: { all: number, owner: number, admin: number, member: number }
}

export interface WorkspaceInvitationRecord {
  id: string
  email: string
  role: InvitableRole
  expiresAt: string
  createdAt: string
  expired: boolean
  inviterName: string
  inviterEmail: string
}

export interface WorkspaceInvitationsResponse {
  items: WorkspaceInvitationRecord[]
  pagination: PaginationMeta
}

export interface WorkspaceAuditRecord {
  id: string
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  actorName: string | null
  actorEmail: string | null
}

export interface WorkspaceAuditResponse {
  items: WorkspaceAuditRecord[]
  pagination: PaginationMeta
}

export type InvitationState
  = 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired' | 'archived' | 'workspace_full'

export interface InvitationPreview {
  state: InvitationState
  email: string
  role: InvitableRole
  expiresAt: string
  organization: { name: string, slug: string }
  inviterName: string
}

export interface SlugAvailability {
  available: boolean
  reason: 'invalid' | 'taken' | null
  message: string
}

export const workspacesApi = {
  listEndpoint: '/api/workspaces' as const,
  detailEndpoint: (slug: string) => resource('/api/workspaces', slug),
  membersEndpoint: (slug: string) => resource('/api/workspaces', slug, '/members'),
  invitationsEndpoint: (slug: string) => resource('/api/workspaces', slug, '/invitations'),
  auditEndpoint: (slug: string) => resource('/api/workspaces', slug, '/audit'),
  slugAvailable: (slug: string) => $fetch<SlugAvailability>('/api/workspace-slug-available', { query: { slug } }),
  updateAddress: (slug: string, next: string) => $fetch<{ slug: string }>(
    resource('/api/workspaces', slug, '/address'),
    { method: 'PATCH', body: { slug: next } }
  ),
  transferOwnership: (slug: string, memberId: string) => $fetch<{ ownerMemberId: string, yourRole: 'admin' }>(
    resource('/api/workspaces', slug, '/transfer-ownership'),
    { method: 'POST', body: { memberId } }
  ),
  archive: (slug: string, confirmation: string) => $fetch<{ archived: true, cancelledBookings: number }>(
    resource('/api/workspaces', slug, '/archive'),
    { method: 'POST', body: { confirmation } }
  )
}

export const invitationsApi = {
  previewEndpoint: (id: string) => resource('/api/invitations', id),
  preview: (id: string) => $fetch<InvitationPreview>(resource('/api/invitations', id))
}
