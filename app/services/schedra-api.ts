import type { PaginationMeta } from '#shared/pagination'
import type {
  BillingInterval,
  CollectionCurrency,
  InvitableRole,
  OrganizationEntitlement,
  OrganizationRole,
  PersonalPlanEntitlement
} from '#shared/billing'
import type {
  OrganizationBrandingInput,
  PersonalBrandingInput,
  PublicPersonalBranding
} from '#shared/branding'
import type {
  AssignmentMode,
  BookingAnswer,
  BookingQuestion,
  EventTypeInput,
  MeetingLocationType,
  TeamEventTemplateDefaults,
  TeamEventTypeInput
} from '#shared/validation'
import type { RecurringBookingRequest, RecurringOccurrencePreview } from '#shared/recurrence'
import type { WorkflowAction, WorkflowInput, WorkflowTrigger } from '#shared/workflows'
import type { RoutingFormInput, RoutingQuestion, RoutingRule } from '#shared/routing'
import type { EventTypeRecord } from '~/types/event-type'
import type { CreateBookingLinkInput } from '#shared/booking-links'
import type { AwayPeriodInput } from '#shared/away-periods'
import type { ScheduleOverrideRecord, ScheduleRecord, ScheduleRuleRecord } from '~/types/schedule'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'

export interface BookingRecord {
  uid: string
  status: 'awaiting_payment' | 'pending' | 'confirmed' | 'cancelled' | 'rejected'
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
  seriesPosition: number | null
  seriesOccurrenceCount: number | null
  seriesFrequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly' | null
  hostName: string
  hostUsername: string
  teamName: string | null
  teamSlug: string | null
  bookingPath: string
  hosts: Array<{ name: string, isOrganizer: boolean }>
  notes: string | null
  answers: BookingAnswer[]
  canHostManage: boolean
  payment: null | {
    status: 'pending' | 'paid' | 'failed' | 'expired' | 'refund_pending' | 'refunded' | 'refund_failed'
    amountCents: number
    currency: 'USD' | 'NGN'
    checkoutUrl: string | null
    expiresAt: string | null
    recoveryAvailable: boolean
  }
}

export interface CreateBookingResult {
  start: string
  uid: string
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl: string | null
  status: BookingRecord['status']
  seriesCount?: number
  occurrences?: Array<{ uid: string, start: string, end: string }>
  checkoutUrl?: string | null
  paymentExpiresAt?: string | null
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

export interface AwayPeriodRecord {
  id: string
  name: string
  startDate: string
  endDate: string
  timeZone: string
  conflictingBookingCount: number
  createdAt: string
  updatedAt: string
}

export interface AwayPeriodsResponse {
  items: AwayPeriodRecord[]
  timeZone: string
}

export interface CalendarConnection {
  connected: boolean
  configured: boolean
  status?: 'active' | 'needs_reauthorization' | 'disconnected'
  setupRequired?: boolean
  writeEnabled?: boolean
  defaultForBookings?: boolean
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
  branding: PublicPersonalBranding
  eventTypes: Array<{
    slug: string
    title: string
    description: string | null
    durationMinutes: number
    durationOptionsMinutes: number[]
    paymentEnabled: boolean
    priceCents: number | null
    paymentCurrency: 'USD' | 'NGN'
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
  durationOptionsMinutes: number[]
  recurringBookingEnabled: boolean
  recurringBookingMaxOccurrences: number
  locationType: MeetingLocationType
  locationDetails: string
  bookingQuestions: BookingQuestion[]
  requiresConfirmation: boolean
  capacity: number
  paymentEnabled: boolean
  priceCents: number | null
  paymentCurrency: 'USD' | 'NGN'
  branding?: PublicPersonalBranding
}

export interface AvailabilityResponse {
  timeZone: string
  durationMinutes: number
  slots: Array<{ start: string, end: string, availableSeats?: number }>
}

export interface RecurrencePreviewResponse {
  occurrences: RecurringOccurrencePreview[]
}

export interface CreateBookingInput {
  username: string
  slug: string
  start: string
  durationMinutes?: number
  requestId?: string
  recurrence?: RecurringBookingRequest
  name: string
  email: string
  timeZone: string
  notes?: string
  answers?: Record<string, string>
  guestEmails?: string[]
  inviteToken?: string
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
  reconcilePayment: (uid: string) => $fetch<{ status: 'confirmed' | 'pending' | 'failed' | 'expired' | 'refund_pending' }>(
    resource('/api/booking', uid, '/payment-status'),
    { method: 'POST' }
  ),
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

export const recurrenceApi = {
  preview: (body: {
    mode: 'personal' | 'team'
    owner: string
    slug: string
    start: string
    durationMinutes: number
    timeZone: string
    recurrence: RecurringBookingRequest
  }) => $fetch<RecurrencePreviewResponse>('/api/recurrence-preview', { method: 'POST', body })
}

export const eventTypesApi = {
  listEndpoint: '/api/event-types' as const,
  create: (body: EventTypeInput) => $fetch('/api/event-types', { method: 'POST', body }),
  duplicate: (id: string) => $fetch<{ id: string }>(resource('/api/event-types', id, '/duplicate'), { method: 'POST' }),
  update: (id: string, body: EventTypeInput) => $fetch(resource('/api/event-types', id), { method: 'PATCH', body }),
  remove: (id: string) => $fetch(resource('/api/event-types', id), { method: 'DELETE' }),
  slots: (id: string, query: { from: string, to: string, durationMinutes?: number }) => $fetch<AvailabilityResponse>(
    resource('/api/event-types', id, '/slots'), { query }
  )
}

export interface BookingLinkRecord {
  id: string
  kind: 'single_use' | 'one_off'
  label: string | null
  eventTypeId: string
  eventTitle: string
  eventSlug: string
  status: 'available' | 'booked' | 'expired' | 'revoked'
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface BookingLinksResponse {
  items: BookingLinkRecord[]
  counts: { all: number, available: number, booked: number, closed: number }
  pagination: PaginationMeta
}

export const bookingLinksApi = {
  listEndpoint: '/api/booking-links' as const,
  optionsEndpoint: '/api/booking-links/options' as const,
  create: (body: CreateBookingLinkInput) => $fetch<{ id: string, token: string, path: string, expiresAt: string }>(
    '/api/booking-links', { method: 'POST', body }
  ),
  revoke: (id: string) => $fetch(resource('/api/booking-links', id), { method: 'DELETE' })
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

export interface RoutingFormSummary {
  id: string
  slug: string
  title: string
  description: string | null
  active: boolean
  questions: RoutingQuestion[]
  defaultEventTitle: string
  responseCount: number
  createdAt: string
}

export interface RoutingFormRecord extends Omit<RoutingFormInput, 'rules'> {
  id: string
  rules: RoutingRule[]
}

export interface RoutingFormsResponse {
  items: RoutingFormSummary[]
  eventTypes: Array<{ id: string, title: string, slug: string }>
}

function routingBase(teamSlug?: string) {
  return teamSlug ? resource('/api/teams', teamSlug, '/routing-forms') : '/api/routing-forms'
}

export const routingFormsApi = {
  listEndpoint: (teamSlug?: string) => routingBase(teamSlug),
  get: (id: string, teamSlug?: string) =>
    $fetch<RoutingFormRecord>(`${routingBase(teamSlug)}/${encodeURIComponent(id)}`),
  create: (body: RoutingFormInput, teamSlug?: string) =>
    $fetch<{ id: string }>(routingBase(teamSlug), { method: 'POST', body }),
  update: (id: string, body: RoutingFormInput, teamSlug?: string) =>
    $fetch<{ id: string }>(`${routingBase(teamSlug)}/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string, teamSlug?: string) =>
    $fetch(`${routingBase(teamSlug)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface AnalyticsResponse {
  range: { days: 7 | 30 | 90, from: string, to: string }
  scope: 'personal' | 'team' | 'mine'
  summary: {
    total: number
    confirmed: number
    pending: number
    cancelled: number
    completed: number
    cancellationRate: number
    completionRate: number
    averageLeadHours: number
    totalChange: number | null
    confirmedChange: number | null
  }
  daily: Array<{ date: string, value: number }>
  sources: { hosted: number, embed: number }
  revenue: Array<{ currency: 'USD' | 'NGN', amountCents: number }>
  eventTypes: Array<{
    id: string
    title: string
    total: number
    confirmed: number
    cancelled: number
    cancellationRate: number
  }>
  options: Array<{ id: string, title: string }>
}

export const analyticsApi = {
  endpoint: (teamSlug?: string) => teamSlug ? resource('/api/teams', teamSlug, '/analytics') : '/api/analytics'
}

export const schedulesApi = {
  listEndpoint: '/api/schedules' as const,
  create: (body: { name: string, timeZone: string }) => $fetch<{ id: string }>('/api/schedules', { method: 'POST', body }),
  duplicate: (id: string) => $fetch<{ id: string }>(resource('/api/schedules', id, '/duplicate'), { method: 'POST' }),
  update: (id: string, body: ScheduleUpdateInput) => $fetch(resource('/api/schedules', id), { method: 'PATCH', body }),
  remove: (id: string) => $fetch(resource('/api/schedules', id), { method: 'DELETE' })
}

export const awayPeriodsApi = {
  endpoint: '/api/away-periods' as const,
  create: (body: AwayPeriodInput) => $fetch<AwayPeriodRecord>('/api/away-periods', { method: 'POST', body }),
  update: (id: string, body: AwayPeriodInput) => $fetch<AwayPeriodRecord>(resource('/api/away-periods', id), { method: 'PATCH', body }),
  remove: (id: string) => $fetch(resource('/api/away-periods', id), { method: 'DELETE' })
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

export const brandingApi = {
  endpoint: '/api/personal-branding' as const,
  update: (body: PersonalBrandingInput) => $fetch<{ branding: PublicPersonalBranding }>('/api/personal-branding', { method: 'PATCH', body }),
  uploadLogo: (file: File) => {
    const body = new FormData()
    body.append('logo', file)
    return $fetch<{ logoUrl: string }>('/api/profile/brand-logo', { method: 'PUT', body })
  },
  removeLogo: () => $fetch('/api/profile/brand-logo', { method: 'DELETE' })
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
    $fetch('/api/resend-verification', {
      method: 'POST',
      body: { email, callbackURL }
    })
}

export const calendarApi = {
  connectionEndpoint: '/api/integrations/google-calendar' as const,
  calendars: () => $fetch<CalendarsResponse>('/api/integrations/google-calendar/calendars'),
  update: (body: { conflictCalendarIds: string[], writeCalendarId: string, defaultForBookings?: boolean }) => $fetch('/api/integrations/google-calendar', { method: 'PATCH', body }),
  disconnect: () => $fetch('/api/integrations/google-calendar', { method: 'DELETE' })
}

export type CalendarIntegrationProvider = 'google-calendar' | 'microsoft-calendar' | 'caldav'

export function calendarIntegrationApi(provider: CalendarIntegrationProvider) {
  const endpoint = `/api/integrations/${provider}` as const
  return {
    connectionEndpoint: endpoint,
    connectEndpoint: `${endpoint}/connect`,
    connect: (body: { username: string, password: string }) =>
      $fetch<CalendarConnection>(`${endpoint}/connect`, { method: 'POST', body }),
    calendars: () => $fetch<CalendarsResponse>(`${endpoint}/calendars`),
    update: (body: { conflictCalendarIds: string[], writeCalendarId: string | null, defaultForBookings?: boolean }) =>
      $fetch<{ ok: true, syncQueued: boolean }>(endpoint, { method: 'PATCH', body }),
    disconnect: () => $fetch(endpoint, { method: 'DELETE' })
  }
}

export interface IntegrationSyncHealth {
  pending: number
  processing: number
  failed: number
  lastError: string | null
  failureProvider: 'google' | 'microsoft' | 'caldav' | 'zoom' | null
  retryableProviderCounts: Partial<Record<'google' | 'microsoft' | 'caldav' | 'zoom', number>>
}

export const integrationHealthApi = {
  endpoint: '/api/integrations/health' as const,
  retry: (provider?: 'google' | 'microsoft' | 'caldav' | 'zoom') => $fetch<{ retried: number }>('/api/integrations/retry', {
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
  delayed?: boolean
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
  paymentsEndpoint: '/api/operations/payments' as const,
  overview: () => $fetch<OperationsOverview>('/api/operations/overview'),
  jobs: (query: { kind: OperationKind, status: OperationStatus, page: number, pageSize?: number }) =>
    $fetch<OperationsJobsResponse>('/api/operations/jobs', { query: { pageSize: DEFAULT_LIST_PAGE_SIZE, ...query } }),
  diagnostics: () => $fetch<OperationsDiagnostics>('/api/operations/diagnostics'),
  retry: (kind: OperationKind, id: string) => $fetch<{ retried: true }>('/api/operations/retry', {
    method: 'POST', body: { kind, id }
  }),
  acknowledgeAlert: (id: string) => $fetch<{ acknowledged: true }>(
    `/api/operations/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' }
  )
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

export const invitationBookingApi = {
  pageEndpoint: (token: string) => resource('/api/meeting-links/guest', token),
  availabilityEndpoint: (token: string) => resource('/api/meeting-links/guest', token, '/availability')
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

export const teamBrandingApi = {
  endpoint: (slug: string) => resource('/api/teams', slug, '/branding'),
  update: (slug: string, body: OrganizationBrandingInput) =>
    $fetch<{ branding: PublicPersonalBranding }>(resource('/api/teams', slug, '/branding'), { method: 'PATCH', body }),
  uploadLogo: (slug: string, file: File) => {
    const body = new FormData()
    body.append('logo', file)
    return $fetch<{ logoUrl: string }>(resource('/api/teams', slug, '/brand-logo'), { method: 'PUT', body })
  },
  removeLogo: (slug: string) =>
    $fetch(resource('/api/teams', slug, '/brand-logo'), { method: 'DELETE' })
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
  additionalDurationMinutes: number[]
  recurringBookingEnabled: boolean
  recurringBookingMaxOccurrences: number
  maxPerDay: number | null
  maxPerWeek: number | null
  maxPerMonth: number | null
  assignmentMode: AssignmentMode
  locationType: MeetingLocationType
  requiresConfirmation: boolean
  capacity: number
  paymentEnabled: boolean
  priceCents: number | null
  paymentCurrency: 'USD' | 'NGN'
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

export interface TeamEventTemplateRecord {
  id: string
  name: string
  defaults: TeamEventTemplateDefaults
  sourceEventTypeId: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TeamEventTemplatesResponse {
  items: TeamEventTemplateRecord[]
  sourceEventTypes: Array<{ id: string, title: string, durationMinutes: number }>
}

export const teamEventTemplatesApi = {
  listEndpoint: (slug: string) => resource('/api/teams', slug, '/event-templates'),
  create: (slug: string, body: { name: string, sourceEventTypeId: string }) =>
    $fetch<{ id: string }>(resource('/api/teams', slug, '/event-templates'), { method: 'POST', body }),
  update: (slug: string, id: string, body: { name: string, sourceEventTypeId: string }) =>
    $fetch<{ id: string }>(`${resource('/api/teams', slug, '/event-templates')}/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  archive: (slug: string, id: string) =>
    $fetch(`${resource('/api/teams', slug, '/event-templates')}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface PaymentAccountSummary {
  configured: boolean
  status: 'not_started' | 'onboarding' | 'pending_review' | 'active' | 'restricted' | 'disabled' | 'unavailable'
  ready: boolean
  nextAction: 'provider_onboarding' | 'none'
  lastError: string | null
  lastCheckedAt: string | null
  platformFeeBps: number
}

export interface PaymentActivityRecord {
  id: string
  kind: 'checkout' | 'customer_payment' | 'platform_fee' | 'processing_fee' | 'settlement' | 'refund'
  direction: 'none' | 'in' | 'out'
  status: 'pending' | 'succeeded' | 'failed' | 'expired'
  amountCents: number | null
  currency: 'USD' | 'NGN'
  provider: 'bachs'
  providerEventId: string | null
  providerObjectId: string | null
  message: string | null
  metadata: Record<string, string | number | boolean | null>
  occurredAt: string
  paymentReference: string
  platformFeeCents: number | null
  attendeeName: string
  attendeeEmail: string
  eventTitle: string
  label: string
  icon: string
  from: string
  to: string
  owner: string
  bookingPath: string
}

export interface PaymentActivityResponse {
  items: PaymentActivityRecord[]
  pagination: PaginationMeta
}

export interface PaymentMoneyTotal {
  currency: 'USD' | 'NGN'
  amountCents: number
}

export interface PaymentSummary {
  collected: PaymentMoneyTotal[]
  available: PaymentMoneyTotal[]
  pending: PaymentMoneyTotal[]
  withdrawn: PaymentMoneyTotal[]
  providerStatus: 'not_connected' | 'available' | 'unavailable'
  updatedAt: string
}

export interface PaymentWithdrawalDestination {
  id: string
  name: string
  type: 'bank_account' | 'mobile_money' | 'crypto_wallet'
  currency: 'USD' | 'NGN'
  isDefault: boolean
}

export interface PaymentWithdrawalRecord {
  id: string
  status: 'creating' | 'pending' | 'processing' | 'completed' | 'failed' | 'unknown'
  destinationName: string
  sourceCurrency: 'USD' | 'NGN'
  destinationCurrency: 'USD' | 'NGN'
  requestedAmountCents: number
  deliveredAmountCents: number | null
  feeCents: number | null
  totalDebitedCents: number | null
  failureReason: string | null
  providerPayoutId: string | null
  createdAt: string
  completedAt: string | null
}

export interface PaymentWithdrawalOptions {
  ready: boolean
  status: PaymentAccountSummary['status']
  available: PaymentMoneyTotal[]
  destinations: PaymentWithdrawalDestination[]
  withdrawals: PaymentWithdrawalRecord[]
}

export interface PaymentWithdrawalPreview {
  confirmationToken: string
  sourceCurrency: 'USD' | 'NGN'
  destinationCurrency: 'USD' | 'NGN'
  requestedAmountCents: number
  deliveredAmountCents: number
  feeCents: number | null
  totalDebitedCents: number
  exchangeRate: string | null
  destination: PaymentWithdrawalDestination
  expiresAt: string
}

export const paymentsApi = {
  endpoint: '/api/payment-account',
  teamEndpoint: (slug: string) => resource('/api/teams', slug, '/payment-account'),
  activityEndpoint: (teamSlug?: string) => teamSlug
    ? resource('/api/teams', teamSlug, '/payment-activity')
    : '/api/payment-activity',
  summaryEndpoint: (teamSlug?: string) => teamSlug
    ? resource('/api/teams', teamSlug, '/payment-summary')
    : '/api/payment-summary',
  withdrawalsEndpoint: (teamSlug?: string) => teamSlug
    ? resource('/api/teams', teamSlug, '/payment-withdrawals')
    : '/api/payment-withdrawals',
  withdrawalPreviewEndpoint: (teamSlug?: string) => teamSlug
    ? resource('/api/teams', teamSlug, '/payment-withdrawals/preview')
    : '/api/payment-withdrawals/preview',
  start: (teamSlug?: string) => $fetch<{ url: string, expiresAt: string }>(
    teamSlug ? resource('/api/teams', teamSlug, '/payment-account') : '/api/payment-account',
    { method: 'POST' }
  ),
  previewWithdrawal: (
    body: { destinationId: string, sourceCurrency: 'USD' | 'NGN', amountCents: number },
    teamSlug?: string
  ) => $fetch<PaymentWithdrawalPreview>(
    teamSlug ? resource('/api/teams', teamSlug, '/payment-withdrawals/preview') : '/api/payment-withdrawals/preview',
    { method: 'POST', body }
  ),
  createWithdrawal: (
    body: { requestId: string, confirmationToken: string },
    teamSlug?: string
  ) => $fetch<PaymentWithdrawalRecord>(
    teamSlug ? resource('/api/teams', teamSlug, '/payment-withdrawals') : '/api/payment-withdrawals',
    { method: 'POST', body }
  )
}

export interface PublicTeamProfile {
  name: string
  slug: string
  logo: string | null
  branding: PublicPersonalBranding
  renamed: boolean
  eventTypes: Array<{
    slug: string
    title: string
    description: string | null
    durationMinutes: number
    durationOptionsMinutes: number[]
    assignmentMode: AssignmentMode
    capacity: number
    paymentEnabled: boolean
    priceCents: number | null
    paymentCurrency: 'USD' | 'NGN'
  }>
}

export interface PublicTeamBookingPage {
  hostName: string
  teamName: string
  teamSlug: string
  title: string
  description: string | null
  durationMinutes: number
  durationOptionsMinutes: number[]
  recurringBookingEnabled: boolean
  recurringBookingMaxOccurrences: number
  assignmentMode: AssignmentMode
  locationType: MeetingLocationType
  locationDetails: string
  bookingQuestions: BookingQuestion[]
  requiresConfirmation: boolean
  capacity: number
  paymentEnabled: boolean
  priceCents: number | null
  paymentCurrency: 'USD' | 'NGN'
  hosts: Array<{ name: string, avatarUrl: string | null }>
  branding: PublicPersonalBranding
}

export interface CreateTeamBookingInput {
  team: string
  slug: string
  start: string
  durationMinutes?: number
  requestId?: string
  recurrence?: RecurringBookingRequest
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
  status: 'awaiting_payment' | 'pending' | 'confirmed' | 'cancelled' | 'rejected'
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

export interface PersonalBillingResponse {
  entitlement: PersonalPlanEntitlement
  configured: boolean
  payment: {
    collectionMethod: 'charge_automatically' | 'invoice'
    collectionCurrency: CollectionCurrency
  }
  invoices: Array<{
    id: string
    reference: string
    status: 'pending' | 'paid' | 'failed' | 'expired'
    interval: BillingInterval
    amountCents: number
    collectionCurrency: CollectionCurrency
    periodStart: string
    periodEnd: string
    paidAt: string | null
    createdAt: string
  }>
}

export const personalBillingApi = {
  summaryEndpoint: '/api/billing' as const,
  checkout: (body: { interval: BillingInterval, currency: CollectionCurrency, requestId: string }) =>
    $fetch<{ checkoutUrl: string, reference: string }>('/api/billing/checkout', { method: 'POST', body }),
  cancel: () => $fetch<{ cancelAtPeriodEnd: boolean, currentPeriodEnd: string | null, autoRenews: boolean }>(
    '/api/billing/cancel',
    { method: 'POST' }
  )
}

export const invitationsApi = {
  previewEndpoint: (id: string) => resource('/api/invitations', id),
  preview: (id: string) => $fetch<InvitationPreview>(resource('/api/invitations', id))
}
