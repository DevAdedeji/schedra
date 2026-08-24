import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
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

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  ...timestamps
}, table => [
  uniqueIndex('organizations_slug_key').on(table.slug)
])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),

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

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),

  ...timestamps
}, table => [
  uniqueIndex('sessions_token_key').on(table.token),
  index('sessions_user_id_idx').on(table.userId)
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

export const calendarSyncAction = pgEnum('calendar_sync_action', ['upsert', 'delete'])
export const calendarSyncStatus = pgEnum('calendar_sync_status', ['pending', 'processing', 'completed', 'failed'])
export const meetingLocationType = pgEnum('meeting_location_type', [
  'google_meet',
  'video_link',
  'phone',
  'in_person',
  'custom'
])

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
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
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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

  hidden: boolean('hidden').notNull().default(false),

  ...timestamps
}, table => [
  uniqueIndex('event_types_user_id_slug_key').on(table.userId, table.slug),
  index('event_types_user_hidden_created_at_idx').on(table.userId, table.hidden, table.createdAt),
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

  locationType: meetingLocationType('location_type').notNull().default('custom'),
  locationDetails: text('location_details').notNull().default('The host will share meeting details before the meeting.'),
  meetingUrl: text('meeting_url'),

  answers: jsonb('answers'),
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

export const bookingCalendarEvents = pgTable('booking_calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => calendarConnections.id, { onDelete: 'set null' }),
  calendarId: text('calendar_id').notNull(),
  eventId: text('event_id').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
}, table => [
  uniqueIndex('booking_calendar_events_booking_key').on(table.bookingId),
  uniqueIndex('booking_calendar_events_remote_key').on(table.calendarId, table.eventId)
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
