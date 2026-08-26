import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'
import type { BookingAnswersSnapshot, BookingAttribution, BookingQuestion, BookingSource } from '#shared/validation'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}

const bytea = customType<{ data: Uint8Array }>({
  dataType: () => 'bytea'
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  // Organizations are archived rather than deleted so booking history, exports
  // and audit records survive. The slug stays reserved so nobody can claim it
  // and inherit traffic from links the archived team shared.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('organizations_slug_key').on(sql`lower(${table.slug})`),
  index('organizations_archived_at_idx').on(table.archivedAt)
])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),

  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name').notNull(),
  username: text('username').notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  timeZone: text('time_zone').notNull().default('UTC'),

  ...timestamps
}, table => [
  uniqueIndex('users_email_key').on(sql`lower(${table.email})`),
  uniqueIndex('users_username_key').on(sql`lower(${table.username})`)
])

export const userAvatars = pgTable('user_avatars', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  size: integer('size').notNull(),
  hash: text('hash').notNull(),
  ...timestamps
}, table => [
  check('user_avatars_size_range', sql`${table.size} > 0 and ${table.size} <= 2097152`)
])

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  activeOrganizationId: uuid('active_organization_id').references(() => organizations.id, { onDelete: 'set null' }),

  ...timestamps
}, table => [
  uniqueIndex('sessions_token_key').on(table.token),
  index('sessions_user_id_idx').on(table.userId)
])

export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  uniqueIndex('members_organization_user_key').on(table.organizationId, table.userId),
  index('members_user_id_idx').on(table.userId),
  index('members_organization_role_idx').on(table.organizationId, table.role),
  check('members_role_allowed', sql`${table.role} in ('owner', 'admin', 'member')`)
])

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  inviterId: uuid('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('invitations_organization_status_idx').on(table.organizationId, table.status),
  index('invitations_email_status_idx').on(sql`lower(${table.email})`, table.status),
  // One live invitation per address per organization; re-inviting supersedes.
  uniqueIndex('invitations_one_pending_per_email')
    .on(table.organizationId, sql`lower(${table.email})`)
    .where(sql`${table.status} = 'pending'`),
  check('invitations_role_allowed', sql`${table.role} in ('admin', 'member')`),
  check('invitations_status_allowed', sql`${table.status} in ('pending', 'accepted', 'rejected', 'canceled')`)
])

/**
 * Billing is per occupied seat. Bachs does not yet let an existing subscription
 * change quantity, so card subscriptions move between fixed-price seat-count
 * products instead. That gives us immediate proration without postponing a new
 * member until renewal. NGN remains invoice-based because a bank transfer cannot
 * be charged automatically.
 */
export const organizationSubscriptions = pgTable('organization_subscriptions', {
  organizationId: uuid('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('trialing'),
  interval: text('interval').notNull().default('yearly'),
  collectionCurrency: text('collection_currency').notNull().default('USD'),
  // 'charge_automatically' once a Bachs subscription is billing a saved card;
  // 'invoice' for the NGN path, which nothing can charge on our behalf.
  collectionMethod: text('collection_method').notNull().default('invoice'),

  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),

  bachsCustomerId: text('bachs_customer_id'),
  bachsSubscriptionId: text('bachs_subscription_id'),
  lastInvoiceReference: text('last_invoice_reference'),
  seatsAtLastInvoice: integer('seats_at_last_invoice'),

  ...timestamps
}, table => [
  index('organization_subscriptions_status_idx').on(table.status),
  check(
    'organization_subscriptions_status_allowed',
    sql`${table.status} in ('trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled')`
  ),
  check(
    'organization_subscriptions_collection_method_allowed',
    sql`${table.collectionMethod} in ('charge_automatically', 'invoice')`
  ),
  check('organization_subscriptions_interval_allowed', sql`${table.interval} in ('monthly', 'yearly')`),
  check(
    'organization_subscriptions_currency_allowed',
    sql`${table.collectionCurrency} in ('USD', 'NGN')`
  ),
  check(
    'organization_subscriptions_seats_positive',
    sql`${table.seatsAtLastInvoice} is null or ${table.seatsAtLastInvoice} > 0`
  )
])

/**
 * Keyed by our own `reference`, which is also the Bachs idempotency key, so a
 * retried checkout and a redelivered webhook converge on one row. Amounts are
 * integer USD cents here and only become decimal strings at the Bachs boundary.
 */
export const organizationInvoices = pgTable('organization_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull(),
  status: text('status').notNull().default('pending'),

  interval: text('interval').notNull(),
  seats: integer('seats').notNull(),
  amountCents: integer('amount_cents').notNull(),
  collectionCurrency: text('collection_currency').notNull().default('USD'),
  // What the customer was actually asked for, in the collection currency, plus
  // the rate used. Kept as decimal strings because that is how Bachs states
  // money, and reconciliation compares against Bachs, not against our cents.
  collectionAmount: text('collection_amount'),
  exchangeRate: text('exchange_rate'),
  // What actually reached the balance, which is not what the customer was
  // charged whenever the customer is bearing the fee.
  settlementAmountCents: integer('settlement_amount_cents'),

  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),

  bachsCheckoutId: text('bachs_checkout_id'),
  bachsChargeId: text('bachs_charge_id'),
  lastError: text('last_error'),

  ...timestamps
}, table => [
  uniqueIndex('organization_invoices_reference_key').on(table.reference),
  index('organization_invoices_organization_created_idx').on(table.organizationId, table.createdAt),
  index('organization_invoices_checkout_idx').on(table.bachsCheckoutId),
  check(
    'organization_invoices_status_allowed',
    sql`${table.status} in ('pending', 'paid', 'failed', 'expired')`
  ),
  check('organization_invoices_seats_positive', sql`${table.seats} > 0`),
  check('organization_invoices_amount_positive', sql`${table.amountCents} > 0`),
  check('organization_invoices_period_ordered', sql`${table.periodEnd} > ${table.periodStart}`)
])

export const organizationAuditLogs = pgTable('organization_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  // Null when Schedra itself acted — an expiry sweep, a webhook, a trial end.
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('organization_audit_logs_organization_created_idx').on(table.organizationId, table.createdAt),
  index('organization_audit_logs_action_idx').on(table.organizationId, table.action)
])

/** Keeps /team/<old-slug> links resolving after a rename. */
export const organizationSlugHistory = pgTable('organization_slug_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  uniqueIndex('organization_slug_history_slug_key').on(sql`lower(${table.slug})`),
  index('organization_slug_history_organization_idx').on(table.organizationId)
])

/**
 * Bachs delivers webhooks more than once by design, and the redirect
 * verification races them. Claiming the event id makes reprocessing a no-op.
 */
export const bachsWebhookEvents = pgTable('bachs_webhook_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('bachs_webhook_events_received_at_idx').on(table.receivedAt)
])

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),

  password: text('password'),

  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),

  ...timestamps
}, table => [
  index('accounts_user_id_idx').on(table.userId)
])

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),

  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  ...timestamps
}, table => [
  index('verifications_identifier_idx').on(table.identifier)
])

export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull()
}, table => [
  uniqueIndex('rate_limits_key_key').on(table.key),
  index('rate_limits_last_request_idx').on(table.lastRequest)
])

export const apiRateLimits = pgTable('api_rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  requestCount: integer('request_count').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
}, table => [
  index('api_rate_limits_expires_at_idx').on(table.expiresAt),
  check('api_rate_limits_request_count_positive', sql`${table.requestCount} > 0`)
])

export const emailDeliveryStatus = pgEnum('email_delivery_status', [
  'pending',
  'sending',
  'sent',
  'failed',
  'cancelled'
])

export const emailOutbox = pgTable('email_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  dedupeKey: text('dedupe_key').notNull(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  preheader: text('preheader'),
  heading: text('heading').notNull(),
  body: text('body').notNull(),
  details: jsonb('details').$type<Array<{
    label: string
    value: string
    url?: string
  }>>(),
  actionLabel: text('action_label').notNull(),
  actionUrl: text('action_url').notNull(),
  footer: text('footer'),
  bookingUid: text('booking_uid'),
  category: text('category').notNull().default('transactional'),
  status: emailDeliveryStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...timestamps
}, table => [
  uniqueIndex('email_outbox_dedupe_key_key').on(table.dedupeKey),
  index('email_outbox_claim_idx').on(table.status, table.availableAt),
  index('email_outbox_booking_uid_idx').on(table.bookingUid, table.category),
  check('email_outbox_attempts_non_negative', sql`${table.attempts} >= 0`)
])

export const calendarConnectionStatus = pgEnum('calendar_connection_status', [
  'active',
  'needs_reauthorization',
  'disconnected'
])

export const calendarConnections = pgTable('calendar_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('google'),
  accountLabel: text('account_label'),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  scope: text('scope').notNull(),
  conflictCalendarIds: jsonb('conflict_calendar_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  writeCalendarId: text('write_calendar_id'),
  status: calendarConnectionStatus('status').notNull().default('active'),
  lastError: text('last_error'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('calendar_connections_user_provider_key').on(table.userId, table.provider),
  index('calendar_connections_user_id_idx').on(table.userId)
])

export const videoConferenceConnections = pgTable('video_conference_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('zoom'),
  providerAccountId: text('provider_account_id').notNull(),
  accountLabel: text('account_label'),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  scope: text('scope').notNull(),
  status: calendarConnectionStatus('status').notNull().default('active'),
  lastError: text('last_error'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('video_conference_connections_user_provider_key').on(table.userId, table.provider),
  index('video_conference_connections_user_id_idx').on(table.userId)
])

export const calendarSyncAction = pgEnum('calendar_sync_action', ['upsert', 'delete'])
export const calendarSyncStatus = pgEnum('calendar_sync_status', ['pending', 'processing', 'completed', 'failed'])
export const meetingLocationType = pgEnum('meeting_location_type', [
  'google_meet',
  'zoom',
  'video_link',
  'phone',
  'in_person',
  'custom'
])

export const assignmentMode = pgEnum('assignment_mode', [
  'single',
  'round_robin',
  'collective'
])

// Schedules stay personal even when a member joins an organization: a team
// event borrows the member's own hours, it never owns them.
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  timeZone: text('time_zone').notNull(),
  isDefault: boolean('is_default').notNull().default(false),

  ...timestamps
}, table => [
  index('schedules_user_id_idx').on(table.userId),
  uniqueIndex('schedules_one_default_per_user')
    .on(table.userId)
    .where(sql`${table.isDefault}`)
])

export const availabilityRules = pgTable('availability_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),

  weekday: smallint('weekday').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),

  ...timestamps
}, table => [
  index('availability_rules_schedule_id_idx').on(table.scheduleId),
  check('availability_rules_weekday_range', sql`${table.weekday} between 1 and 7`)
])

export const dateOverrides = pgTable('date_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),

  date: date('date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),

  ...timestamps
}, table => [
  index('date_overrides_schedule_id_date_idx').on(table.scheduleId, table.date),
  check(
    'date_overrides_times_paired',
    sql`(${table.startTime} is null) = (${table.endTime} is null)`
  )
])

export const eventTypes = pgTable('event_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'restrict' }),
  // Personal event types belong to a user; team event types belong to an
  // organization. Keeping this nullable prevents a creator deleting their
  // account from deleting a shared team link.
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),

  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),

  durationMinutes: integer('duration_minutes').notNull(),
  incrementMinutes: integer('increment_minutes'),
  bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
  bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(0),
  minimumNoticeMinutes: integer('minimum_notice_minutes').notNull().default(0),
  bookingWindowDays: integer('booking_window_days'),
  maxPerDay: integer('max_per_day'),
  locationType: meetingLocationType('location_type').notNull().default('custom'),
  locationDetails: text('location_details').notNull().default('The host will share meeting details before the meeting.'),
  reminderMinutes: jsonb('reminder_minutes').$type<number[]>().notNull().default(sql`'[1440, 60]'::jsonb`),
  bookingQuestions: jsonb('booking_questions').$type<BookingQuestion[]>().notNull().default(sql`'[]'::jsonb`),
  requiresConfirmation: boolean('requires_confirmation').notNull().default(false),

  // Personal event types always have exactly one host, so 'single' is both the
  // default and the only mode that applies when organizationId is null.
  assignmentMode: assignmentMode('assignment_mode').notNull().default('single'),

  hidden: boolean('hidden').notNull().default(false),

  ...timestamps
}, table => [
  // A slug is unique per owner: per user for a personal page, per organization
  // for a team page, since the two live in different URL namespaces.
  uniqueIndex('event_types_user_id_slug_key')
    .on(table.userId, table.slug)
    .where(sql`${table.organizationId} is null`),
  uniqueIndex('event_types_organization_slug_key')
    .on(table.organizationId, table.slug)
    .where(sql`${table.organizationId} is not null`),
  index('event_types_organization_hidden_idx')
    .on(table.organizationId, table.hidden, table.createdAt),
  index('event_types_user_hidden_created_at_idx').on(table.userId, table.hidden, table.createdAt),
  check(
    'event_types_exactly_one_owner',
    sql`(${table.organizationId} is null) <> (${table.userId} is null)`
  ),
  check('event_types_duration_positive', sql`${table.durationMinutes} > 0`),
  check(
    'event_types_increment_positive',
    sql`${table.incrementMinutes} is null or ${table.incrementMinutes} > 0`
  ),
  check(
    'event_types_buffers_non_negative',
    sql`${table.bufferBeforeMinutes} >= 0 and ${table.bufferAfterMinutes} >= 0 and ${table.minimumNoticeMinutes} >= 0`
  ),
  check(
    'event_types_max_per_day_positive',
    sql`${table.maxPerDay} is null or ${table.maxPerDay} > 0`
  )
])

/**
 * Who may host a team event, and with which of their own schedules. The
 * membership reference is what makes removal automatic: taking someone out of
 * the team cascades their host rows away, so they stop being assigned without
 * anything else having to notice.
 */
export const eventTypeHosts = pgTable('event_type_hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Null means "whichever schedule is their default at booking time", so a host
  // who reorganises their availability does not silently fall out of rotation.
  scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  // Preserves the order chosen by the team admin. For collective events the
  // first enabled host is the stable organizer and owns the primary invite.
  position: integer('position').notNull().default(0),
  // Reserved for weighted round-robin; every host is equal until it is used.
  weight: integer('weight').notNull().default(100),

  ...timestamps
}, table => [
  uniqueIndex('event_type_hosts_event_member_key').on(table.eventTypeId, table.memberId),
  index('event_type_hosts_event_enabled_idx').on(table.eventTypeId, table.enabled, table.position),
  index('event_type_hosts_user_idx').on(table.userId),
  check('event_type_hosts_position_non_negative', sql`${table.position} >= 0`),
  check('event_type_hosts_weight_positive', sql`${table.weight} > 0`)
])

export const bookingStatus = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'cancelled',
  'rejected'
])

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'restrict' }),
  hostId: uuid('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  uid: text('uid').notNull(),
  status: bookingStatus('status').notNull().default('confirmed'),

  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),

  attendeeName: text('attendee_name').notNull(),
  attendeeEmail: text('attendee_email').notNull(),
  attendeeTimeZone: text('attendee_time_zone').notNull(),
  additionalGuestEmails: jsonb('additional_guest_emails').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

  locationType: meetingLocationType('location_type').notNull().default('custom'),
  locationDetails: text('location_details').notNull().default('The host will share meeting details before the meeting.'),
  meetingUrl: text('meeting_url'),

  answers: jsonb('answers').$type<BookingAnswersSnapshot>(),
  source: text('source').$type<BookingSource>().notNull().default('hosted'),
  attribution: jsonb('attribution').$type<BookingAttribution>(),
  cancellationReason: text('cancellation_reason'),
  rescheduledFromId: uuid('rescheduled_from_id'),

  ...timestamps
}, table => [
  uniqueIndex('bookings_uid_key').on(table.uid),
  index('bookings_host_id_starts_at_idx').on(table.hostId, table.startsAt),
  index('bookings_host_status_ends_at_idx').on(table.hostId, table.status, table.endsAt),
  index('bookings_event_type_id_idx').on(table.eventTypeId),
  check('bookings_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`)
])

/**
 * Every booking reserves its hosts here — personal ones through a trigger, team
 * ones with a row per host. One Postgres exclusion constraint over this table
 * is therefore the single guard against double-booking anybody, whether the
 * clash is between two team events or between a team event and a personal one.
 */
export const bookingHosts = pgTable('booking_hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // The organizer owns the calendar event and the meeting link; the rest attend.
  isOrganizer: boolean('is_organizer').notNull().default(false),

  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  // Set when the booking stops holding time, which frees the slot without
  // losing the record of who was assigned.
  releasedAt: timestamp('released_at', { withTimezone: true }),

  ...timestamps
}, table => [
  uniqueIndex('booking_hosts_booking_user_key').on(table.bookingId, table.userId),
  index('booking_hosts_user_starts_idx').on(table.userId, table.startsAt),
  check('booking_hosts_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`)
])

export const bookingCalendarEvents = pgTable('booking_calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  // A collective booking can have one remote event per assigned host.
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => calendarConnections.id, { onDelete: 'set null' }),
  calendarId: text('calendar_id').notNull(),
  eventId: text('event_id').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
}, table => [
  uniqueIndex('booking_calendar_events_booking_user_key').on(table.bookingId, table.userId),
  index('booking_calendar_events_user_id_idx').on(table.userId),
  uniqueIndex('booking_calendar_events_remote_key').on(table.calendarId, table.eventId)
])

export const bookingConferenceMeetings = pgTable('booking_conference_meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => videoConferenceConnections.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('zoom'),
  meetingId: text('meeting_id').notNull(),
  joinUrl: text('join_url').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
}, table => [
  uniqueIndex('booking_conference_meetings_booking_provider_key').on(table.bookingId, table.provider),
  index('booking_conference_meetings_user_id_idx').on(table.userId),
  uniqueIndex('booking_conference_meetings_remote_key').on(table.provider, table.meetingId)
])

export const calendarSyncJobs = pgTable('calendar_sync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  action: calendarSyncAction('action').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  status: calendarSyncStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...timestamps
}, table => [
  uniqueIndex('calendar_sync_jobs_dedupe_key_key').on(table.dedupeKey),
  index('calendar_sync_jobs_claim_idx').on(table.status, table.availableAt),
  check('calendar_sync_jobs_attempts_non_negative', sql`${table.attempts} >= 0`)
])

export const billingSyncStatus = pgEnum('billing_sync_status', [
  'pending',
  'processing',
  'completed',
  'failed'
])

/**
 * Membership changes must not depend on Bachs being reachable. Each accepted
 * or removed membership creates a durable job; workers derive the current seat
 * count when they run, making rapid or out-of-order changes converge safely.
 */
export const subscriptionSeatSyncJobs = pgTable('subscription_seat_sync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  status: billingSyncStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...timestamps
}, table => [
  uniqueIndex('subscription_seat_sync_jobs_organization_key').on(table.organizationId),
  index('subscription_seat_sync_jobs_claim_idx').on(table.status, table.availableAt),
  index('subscription_seat_sync_jobs_organization_idx').on(table.organizationId, table.createdAt),
  check('subscription_seat_sync_jobs_attempts_non_negative', sql`${table.attempts} >= 0`)
])
