import type { PaginationMeta } from '#shared/pagination'
import type {
  BillingInterval,
  CollectionCurrency,
  InvitableRole,
  OrganizationEntitlement,
  OrganizationRole
} from '#shared/billing'
import type {
  AssignmentMode,
  BookingAnswer,
  BookingQuestion,
  EventTypeInput,
  MeetingLocationType,
  TeamEventTypeInput
} from '#shared/validation'
import type { WorkflowAction, WorkflowInput, WorkflowTrigger } from '#shared/workflows'
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
  teamName: string | null
  teamSlug: string | null
  bookingPath: string
  hosts: Array<{ name: string, isOrganizer: boolean }>
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
  setupRequired?: boolean
  supportsMicrosoftTeams?: boolean
  accountLabel?: string | null
  conflictCalendarIds?: string[]
  writeCalendarId?: string | null
  lastError?: string | null
  lastCheckedAt?: string | null
}

export type VideoConferenceConnection = Pick<CalendarConnection,
  'connected' | 'configured' | 'status' | 'accountLabel' | 'lastError'>

export interface CalendarItem {
  id: string
  summary: string
  primary: boolean
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
  backgroundColor?: string
  unavailable?: boolean
  shared?: boolean
  owner?: string
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
  capacity: number
}

export interface AvailabilityResponse {
  timeZone: string
  durationMinutes: number
  slots: Array<{ start: string, end: string, availableSeats?: number }>
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

export interface WorkflowRecord {
  id: string
  name: string
  trigger: WorkflowTrigger
  offsetMinutes: number
  action: WorkflowAction
  active: boolean
  eventTypeId: string | null
  eventTypeTitle: string | null
  webhookConfigured: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkflowsResponse {
  items: WorkflowRecord[]
  pagination: PaginationMeta
}

export interface WorkflowWriteResult {
  id: string
  webhookSecret: string | null
}

function workflowBase(teamSlug?: string) {
  return teamSlug ? resource('/api/teams', teamSlug, '/workflows') : '/api/workflows'
}

export const workflowsApi = {
  listEndpoint: (teamSlug?: string) => workflowBase(teamSlug),
  create: (body: WorkflowInput, teamSlug?: string) =>
    $fetch<WorkflowWriteResult>(workflowBase(teamSlug), { method: 'POST', body }),
  update: (id: string, body: WorkflowInput, teamSlug?: string) =>
    $fetch<WorkflowWriteResult>(`${workflowBase(teamSlug)}/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  setActive: (id: string, active: boolean, teamSlug?: string) =>
    $fetch(`${workflowBase(teamSlug)}/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { active } }),
  remove: (id: string, teamSlug?: string) =>
    $fetch(`${workflowBase(teamSlug)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
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

export interface UsernameAvailability {
  available: boolean
  reason: 'invalid' | 'taken' | null
  message: string
}

export const usernameApi = {
  check: (username: string, signal?: AbortSignal) => $fetch<UsernameAvailability>('/api/username-available', {
    query: { username },
    signal
  })
}

export const authApi = {
  resendVerification: (email: string, callbackURL: string) =>
    $fetch('/api/auth/send-verification-email', {
      method: 'POST',
      body: { email, callbackURL }
    })
}

export const calendarApi = {
  connectionEndpoint: '/api/integrations/google-calendar' as const,
  calendars: () => $fetch<CalendarsResponse>('/api/integrations/google-calendar/calendars'),
  update: (body: { conflictCalendarIds: string[], writeCalendarId: string }) => $fetch('/api/integrations/google-calendar', { method: 'PATCH', body }),
  disconnect: () => $fetch('/api/integrations/google-calendar', { method: 'DELETE' })
}

export type CalendarIntegrationProvider = 'google-calendar' | 'microsoft-calendar'

export function calendarIntegrationApi(provider: CalendarIntegrationProvider) {
  const endpoint = `/api/integrations/${provider}` as const
  return {
    connectionEndpoint: endpoint,
    connectEndpoint: `${endpoint}/connect`,
    calendars: () => $fetch<CalendarsResponse>(`${endpoint}/calendars`),
    update: (body: { conflictCalendarIds: string[], writeCalendarId: string | null }) =>
      $fetch<{ ok: true, syncQueued: boolean }>(endpoint, { method: 'PATCH', body }),
    disconnect: () => $fetch(endpoint, { method: 'DELETE' })
  }
}

export interface IntegrationSyncHealth {
  pending: number
  processing: number
  failed: number
  lastError: string | null
  failureProvider: 'google' | 'microsoft' | 'zoom' | null
  retryableProviderCounts: Partial<Record<'google' | 'microsoft' | 'zoom', number>>
}

export const integrationHealthApi = {
  endpoint: '/api/integrations/health' as const,
  retry: (provider?: 'google' | 'microsoft' | 'zoom') => $fetch<{ retried: number }>('/api/integrations/retry', {
    method: 'POST',
    body: provider ? { provider } : {}
  })
}

export type OperationKind = 'automation' | 'calendar' | 'billing' | 'email' | 'webhook'
export type OperationStatus = 'all' | 'pending' | 'processing' | 'completed' | 'failed' | 'ignored'

export interface OperationsOverview {
  queues: {
    automation: { pending: number, processing: number, failed: number, stale: number }
    calendar: { pending: number, processing: number, failed: number, stale: number }
    billing: { pending: number, processing: number, failed: number, stale: number }
    email: { pending: number, processing: number, failed: number, stale: number }
    webhook: { processing: number, completed: number, failed: number, ignored: number, stale: number }
  }
  alerts: Array<{
    id: string
    type: string
    severity: 'warning' | 'critical'
    summary: string
    details: Record<string, unknown> | null
    firstSeenAt: string
    lastSeenAt: string
  }>
}

export interface OperationsJob {
  id: string
  kind: OperationKind
  status: string
  attempts: number
  availableAt: string
  lastError: string | null
  provider: string | null
  label: string
  retryable: boolean
  createdAt: string
  updatedAt: string
}

export interface OperationsJobsResponse {
  items: OperationsJob[]
  pagination: PaginationMeta
}

export interface OperationsDiagnostics {
  database: { ok: boolean, latencyMs: number }
  worker: { ok: boolean, active: number, lastSeenAt: string | null }
  configuration: {
    email: boolean
    google: boolean
    microsoft: boolean
    zoom: boolean
    bachs: boolean
    alertRecipients: number
  }
}

export const operationsApi = {
  overviewEndpoint: '/api/operations/overview' as const,
  jobsEndpoint: '/api/operations/jobs' as const,
  diagnosticsEndpoint: '/api/operations/diagnostics' as const,
  overview: () => $fetch<OperationsOverview>('/api/operations/overview'),
  jobs: (query: { kind: OperationKind, status: OperationStatus, page: number, pageSize?: number }) =>
    $fetch<OperationsJobsResponse>('/api/operations/jobs', { query: { pageSize: 10, ...query } }),
  diagnostics: () => $fetch<OperationsDiagnostics>('/api/operations/diagnostics'),
  retry: (kind: OperationKind, id: string) => $fetch<{ retried: true }>('/api/operations/retry', {
    method: 'POST', body: { kind, id }
  })
}

export const zoomApi = {
  connectionEndpoint: '/api/integrations/zoom' as const,
  check: () => $fetch<VideoConferenceConnection>('/api/integrations/zoom/check', { method: 'POST' }),
  disconnect: () => $fetch('/api/integrations/zoom', { method: 'DELETE' })
}

export const publicBookingApi = {
  profileEndpoint: (username: string) => resource('/api/profile', username),
  pageEndpoint: (username: string, slug: string) => resource(resource('/api/booking-page', username), slug),
  availabilityEndpoint: '/api/availability' as const
}

export interface TeamSummary {
  id: string
  name: string
  slug: string
  logo: string | null
  role: OrganizationRole
  joinedAt: string
  entitlement: OrganizationEntitlement
}

export interface TeamPermissions {
  inviteMembers: boolean
  removeMembers: boolean
  changeRoles: boolean
  updateTeam: boolean
  changeAddress: boolean
  transferOwnership: boolean
  manageBilling: boolean
  archiveTeam: boolean
  manageEventTypes: boolean
  viewAllBookings: boolean
}

export interface TeamDetail {
  organization: { id: string, name: string, slug: string, logo: string | null, archived: boolean }
  role: OrganizationRole
  entitlement: OrganizationEntitlement
  permissions: TeamPermissions
}

export interface TeamMemberRecord {
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
  integrations: { googleMeet: boolean, microsoftTeams: boolean, zoom: boolean }
}

export interface TeamMembersResponse {
  items: TeamMemberRecord[]
  pagination: PaginationMeta
  counts: { all: number, owner: number, admin: number, member: number }
}

export interface TeamInvitationRecord {
  id: string
  email: string
  role: InvitableRole
  expiresAt: string
  createdAt: string
  expired: boolean
  inviterName: string
  inviterEmail: string
}

export interface TeamInvitationsResponse {
  items: TeamInvitationRecord[]
  pagination: PaginationMeta
}

export interface TeamAuditRecord {
  id: string
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  actorName: string | null
  actorEmail: string | null
}

export interface TeamAuditResponse {
  items: TeamAuditRecord[]
  pagination: PaginationMeta
}

export type InvitationState
  = 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired' | 'archived' | 'team_full'

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

export const teamsApi = {
  listEndpoint: '/api/teams' as const,
  detailEndpoint: (slug: string) => resource('/api/teams', slug),
  membersEndpoint: (slug: string) => resource('/api/teams', slug, '/members'),
  invitationsEndpoint: (slug: string) => resource('/api/teams', slug, '/invitations'),
  auditEndpoint: (slug: string) => resource('/api/teams', slug, '/audit'),
  slugAvailable: (slug: string) => $fetch<SlugAvailability>('/api/team-slug-available', { query: { slug } }),
  updateAddress: (slug: string, next: string) => $fetch<{ slug: string }>(
    resource('/api/teams', slug, '/address'),
    { method: 'PATCH', body: { slug: next } }
  ),
  transferOwnership: (slug: string, memberId: string) => $fetch<{ ownerMemberId: string, yourRole: 'admin' }>(
    resource('/api/teams', slug, '/transfer-ownership'),
    { method: 'POST', body: { memberId } }
  ),
  archive: (slug: string, confirmation: string) => $fetch<{ archived: true, cancelledBookings: number }>(
    resource('/api/teams', slug, '/archive'),
    { method: 'POST', body: { confirmation } }
  )
}

export interface TeamInvoiceRecord {
  id: string
  reference: string
  status: 'pending' | 'paid' | 'failed' | 'expired'
  interval: BillingInterval
  seats: number
  amountCents: number
  collectionCurrency: CollectionCurrency
  periodStart: string
  periodEnd: string
  paidAt: string | null
  createdAt: string
}

export interface TeamBillingResponse {
  entitlement: OrganizationEntitlement
  configured: boolean
  seatBilling: {
    billedSeats: number | null
    collectionMethod: 'charge_automatically' | 'invoice'
    collectionCurrency: CollectionCurrency
    syncStatus: 'pending' | 'processing' | 'completed' | 'failed' | null
    hasError: boolean
    updatedAt: string | null
  }
  invoices: TeamInvoiceRecord[]
}

export interface TeamEventTypeHostRecord {
  eventTypeId: string
  memberId: string
  enabled: boolean
  name: string
  avatarUrl: string | null
}

export interface TeamEventTypeRecord {
  id: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  assignmentMode: AssignmentMode
  locationType: MeetingLocationType
  requiresConfirmation: boolean
  capacity: number
  hidden: boolean
  createdAt: string
  hosts: TeamEventTypeHostRecord[]
}

export type TeamEventTypeDetail = TeamEventTypeInput & {
  hosts: Array<{
    memberId: string
    scheduleId: string | null
    enabled: boolean
    weight: number
  }>
}

export interface TeamEventTypesResponse {
  items: TeamEventTypeRecord[]
  pagination: PaginationMeta
  counts: { all: number, active: number, hidden: number }
}

export const teamEventTypesApi = {
  listEndpoint: (slug: string) => resource('/api/teams', slug, '/event-types'),
  detailEndpoint: (slug: string, id: string) =>
    `${resource('/api/teams', slug, '/event-types')}/${encodeURIComponent(id)}`,
  get: (slug: string, id: string) => $fetch<TeamEventTypeDetail>(
    `${resource('/api/teams', slug, '/event-types')}/${encodeURIComponent(id)}`
  ),
  create: (slug: string, body: TeamEventTypeInput) =>
    $fetch<{ id: string }>(resource('/api/teams', slug, '/event-types'), { method: 'POST', body }),
  update: (slug: string, id: string, body: TeamEventTypeInput) =>
    $fetch(`${resource('/api/teams', slug, '/event-types')}/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (slug: string, id: string) =>
    $fetch(`${resource('/api/teams', slug, '/event-types')}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface PublicTeamProfile {
  name: string
  slug: string
  logo: string | null
  renamed: boolean
  eventTypes: Array<{
    slug: string
    title: string
    description: string | null
    durationMinutes: number
    assignmentMode: AssignmentMode
    capacity: number
  }>
}

export interface PublicTeamBookingPage {
  hostName: string
  teamName: string
  teamSlug: string
  title: string
  description: string | null
  durationMinutes: number
  assignmentMode: AssignmentMode
  locationType: MeetingLocationType
  locationDetails: string
  bookingQuestions: BookingQuestion[]
  requiresConfirmation: boolean
  capacity: number
  hosts: Array<{ name: string, avatarUrl: string | null }>
}

export interface CreateTeamBookingInput {
  team: string
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

export interface TeamBookingRecord {
  uid: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'rejected'
  startsAt: string
  endsAt: string
  attendeeName: string
  attendeeEmail: string
  eventTitle: string
  assignmentMode: AssignmentMode
  locationType: MeetingLocationType
  meetingUrl: string | null
  cancellationReason: string | null
  hosts: Array<{ name: string, isOrganizer: boolean }>
}

export interface TeamBookingsResponse {
  items: TeamBookingRecord[]
  pagination: PaginationMeta
  counts: { upcoming: number, pending: number, past: number, cancelled: number }
  scope: 'team' | 'mine'
}

export const publicTeamApi = {
  profileEndpoint: (slug: string) => resource('/api/team-profile', slug),
  pageEndpoint: (slug: string, eventSlug: string) =>
    resource(resource('/api/team-booking-page', slug), eventSlug),
  availabilityEndpoint: '/api/team-availability' as const,
  create: (body: CreateTeamBookingInput) =>
    $fetch<CreateBookingResult & { hostNames: string[] }>('/api/team-bookings', { method: 'POST', body })
}

export const teamBookingsApi = {
  listEndpoint: (slug: string) => resource('/api/teams', slug, '/bookings')
}

export const teamAuditApi = {
  listEndpoint: (slug: string) => resource('/api/teams', slug, '/audit')
}

export const billingApi = {
  summaryEndpoint: (slug: string) => resource('/api/teams', slug, '/billing'),
  syncSeats: (slug: string) => $fetch<{ queued: true }>(
    resource('/api/teams', slug, '/billing/sync-seats'),
    { method: 'POST' }
  ),
  checkout: (slug: string, body: { interval: BillingInterval, currency: CollectionCurrency }) =>
    $fetch<{ checkoutUrl: string, reference: string }>(
      resource('/api/teams', slug, '/billing/checkout'),
      { method: 'POST', body }
    )
}

export const invitationsApi = {
  previewEndpoint: (id: string) => resource('/api/invitations', id),
  preview: (id: string) => $fetch<InvitationPreview>(resource('/api/invitations', id))
}
