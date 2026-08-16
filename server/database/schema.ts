import { sql } from 'drizzle-orm'
import {
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

  hidden: boolean('hidden').notNull().default(false),

  ...timestamps
}, table => [
  uniqueIndex('event_types_user_id_slug_key').on(table.userId, table.slug),
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

  answers: jsonb('answers'),
  cancellationReason: text('cancellation_reason'),
  rescheduledFromId: uuid('rescheduled_from_id'),

  ...timestamps
}, table => [
  uniqueIndex('bookings_uid_key').on(table.uid),
  index('bookings_host_id_starts_at_idx').on(table.hostId, table.startsAt),
  index('bookings_event_type_id_idx').on(table.eventTypeId),
  check('bookings_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`)
])
