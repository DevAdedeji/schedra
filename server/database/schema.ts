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
import type {
  BookingAnswersSnapshot,
  BookingAttribution,
  BookingQuestion,
  BookingSource,
  TeamEventTemplateDefaults
} from '#shared/validation'
import type { WorkflowAction } from '#shared/workflows'
import type { RoutingCondition } from '#shared/routing'

// PostgreSQL supplies creation time and migration 0041 maintains updated_at
// with a trigger. Application writes may still use sql`now()` when several
// lifecycle fields must visibly share the transaction timestamp.
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
  brandColor: text('brand_color'),
  brandDarkColor: text('brand_dark_color'),
  bookingPageTheme: text('booking_page_theme').notNull().default('system'),
  hideSchedraBranding: boolean('hide_schedra_branding').notNull().default(false),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  // Organizations are archived rather than deleted so booking history, exports
  // and audit records survive. The slug stays reserved so nobody can claim it
  // and inherit traffic from links the archived team shared.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('organizations_slug_key').on(sql`lower(${table.slug})`),
  index('organizations_archived_at_idx').on(table.archivedAt),
  check('organizations_brand_color_valid', sql`${table.brandColor} is null or ${table.brandColor} ~ '^#[0-9A-Fa-f]{6}$'`),
  check('organizations_brand_dark_color_valid', sql`${table.brandDarkColor} is null or ${table.brandDarkColor} ~ '^#[0-9A-Fa-f]{6}$'`),
  check('organizations_booking_page_theme_allowed', sql`${table.bookingPageTheme} in ('system', 'light', 'dark')`)
])

export const organizationBrandLogos = pgTable('organization_brand_logos', {
  organizationId: uuid('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  size: integer('size').notNull(),
  hash: text('hash').notNull(),
  ...timestamps
}, table => [
  check('organization_brand_logos_size_range', sql`${table.size} > 0 and ${table.size} <= 2097152`)
])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),

  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name').notNull(),
  username: text('username').notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  brandName: text('brand_name'),
  brandLogoUrl: text('brand_logo_url'),
  brandColor: text('brand_color'),
  brandDarkColor: text('brand_dark_color'),
  bookingPageTheme: text('booking_page_theme').notNull().default('system'),
  hideSchedraBranding: boolean('hide_schedra_branding').notNull().default(false),
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

export const userBrandLogos = pgTable('user_brand_logos', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  size: integer('size').notNull(),
  hash: text('hash').notNull(),
  ...timestamps
}, table => [
  check('user_brand_logos_size_range', sql`${table.size} > 0 and ${table.size} <= 2097152`)
])

export const awayPeriods = pgTable('away_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  // The timezone is captured when time off is created so changing account
  // settings later cannot silently move the protected boundary.
  timeZone: text('time_zone').notNull(),
  ...timestamps
}, table => [
  index('away_periods_user_dates_idx').on(table.userId, table.startDate, table.endDate),
  check('away_periods_dates_ordered', sql`${table.endDate} >= ${table.startDate}`)
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

export const personalSubscriptions = pgTable('personal_subscriptions', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('canceled'),
  interval: text('interval').notNull().default('yearly'),
  collectionCurrency: text('collection_currency').notNull().default('USD'),
  collectionMethod: text('collection_method').notNull().default('invoice'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  bachsCustomerId: text('bachs_customer_id'),
  bachsSubscriptionId: text('bachs_subscription_id'),
  lastInvoiceReference: text('last_invoice_reference'),
  ...timestamps
}, table => [
  index('personal_subscriptions_status_idx').on(table.status),
  uniqueIndex('personal_subscriptions_bachs_subscription_key')
    .on(table.bachsSubscriptionId)
    .where(sql`${table.bachsSubscriptionId} is not null`),
  check(
    'personal_subscriptions_status_allowed',
    sql`${table.status} in ('trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled')`
  ),
  check(
    'personal_subscriptions_collection_method_allowed',
    sql`${table.collectionMethod} in ('charge_automatically', 'invoice')`
  ),
  check('personal_subscriptions_interval_allowed', sql`${table.interval} in ('monthly', 'yearly')`),
  check(
    'personal_subscriptions_currency_allowed',
    sql`${table.collectionCurrency} in ('USD', 'NGN')`
  )
])

export const personalInvoices = pgTable('personal_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull(),
  status: text('status').notNull().default('pending'),
  interval: text('interval').notNull(),
  amountCents: integer('amount_cents').notNull(),
  collectionCurrency: text('collection_currency').notNull().default('USD'),
  collectionAmount: text('collection_amount'),
  exchangeRate: text('exchange_rate'),
  settlementAmountCents: integer('settlement_amount_cents'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  bachsCheckoutId: text('bachs_checkout_id'),
  checkoutUrl: text('checkout_url'),
  bachsChargeId: text('bachs_charge_id'),
  lastError: text('last_error'),
  ...timestamps
}, table => [
  uniqueIndex('personal_invoices_reference_key').on(table.reference),
  index('personal_invoices_user_created_idx').on(table.userId, table.createdAt),
  index('personal_invoices_checkout_idx').on(table.bachsCheckoutId),
  check(
    'personal_invoices_status_allowed',
    sql`${table.status} in ('pending', 'paid', 'failed', 'expired')`
  ),
  check('personal_invoices_amount_positive', sql`${table.amountCents} > 0`),
  check('personal_invoices_period_ordered', sql`${table.periodEnd} > ${table.periodStart}`),
  check(
    'personal_invoices_currency_allowed',
    sql`${table.collectionCurrency} in ('USD', 'NGN')`
  )
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

/**
 * Cross-cutting security and money-operation history. Organization audit logs
 * remain the customer-visible team record; this table covers personal payout
 * owners, guest capability actions and private platform administration too.
 */
export const securityAuditLogs = pgTable('security_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  requestId: text('request_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('security_audit_logs_created_idx').on(table.createdAt),
  index('security_audit_logs_action_created_idx').on(table.action, table.createdAt),
  index('security_audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt),
  index('security_audit_logs_organization_created_idx').on(table.organizationId, table.createdAt)
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
  // Every provider keeps its own writable calendar so provider-specific
  // locations (Google Meet / Teams) can work independently. Exactly one
  // connection may be the fallback destination for other meeting types.
  isDefaultWriteDestination: boolean('is_default_write_destination').notNull().default(false),
  status: calendarConnectionStatus('status').notNull().default('active'),
  preferencesConfiguredAt: timestamp('preferences_configured_at', { withTimezone: true }),
  supportsMicrosoftTeams: boolean('supports_microsoft_teams').notNull().default(false),
  lastError: text('last_error'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('calendar_connections_user_provider_key').on(table.userId, table.provider),
  uniqueIndex('calendar_connections_one_default_destination_per_user')
    .on(table.userId)
    .where(sql`${table.isDefaultWriteDestination} is true`),
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
  'microsoft_teams',
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
  additionalDurationMinutes: integer('additional_duration_minutes').array().notNull().default(sql`'{}'::integer[]`),
  recurringBookingEnabled: boolean('recurring_booking_enabled').notNull().default(false),
  recurringBookingMaxOccurrences: integer('recurring_booking_max_occurrences').notNull().default(8),
  incrementMinutes: integer('increment_minutes'),
  bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
  bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(0),
  minimumNoticeMinutes: integer('minimum_notice_minutes').notNull().default(0),
  bookingWindowDays: integer('booking_window_days'),
  maxPerDay: integer('max_per_day'),
  maxPerWeek: integer('max_per_week'),
  maxPerMonth: integer('max_per_month'),
  locationType: meetingLocationType('location_type').notNull().default('custom'),
  locationDetails: text('location_details').notNull().default('The host will share meeting details before the meeting.'),
  reminderMinutes: jsonb('reminder_minutes').$type<number[]>().notNull().default(sql`'[1440, 60]'::jsonb`),
  bookingQuestions: jsonb('booking_questions').$type<BookingQuestion[]>().notNull().default(sql`'[]'::jsonb`),
  requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
  // A capacity above one turns a slot into a group session. Each guest keeps a
  // private booking capability while the host receives one shared meeting.
  capacity: integer('capacity').notNull().default(1),
  // Money is always stored in the currency's minor unit. A paid event uses a
  // fixed price for the reservation (not per invited guest), which keeps the
  // amount the guest sees identical to the amount sent to the provider.
  paymentEnabled: boolean('payment_enabled').notNull().default(false),
  priceCents: integer('price_cents'),
  paymentCurrency: text('payment_currency').notNull().default('USD'),

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
    'event_types_additional_durations_valid',
    sql`cardinality(${table.additionalDurationMinutes}) <= 4 and 5 <= all(${table.additionalDurationMinutes}) and 720 >= all(${table.additionalDurationMinutes}) and not (${table.durationMinutes} = any(${table.additionalDurationMinutes}))`
  ),
  check(
    'event_types_recurring_occurrences_range',
    sql`${table.recurringBookingMaxOccurrences} between 2 and 8`
  ),
  check(
    'event_types_recurring_configuration_valid',
    sql`${table.recurringBookingEnabled} = false or (${table.paymentEnabled} = false and ${table.capacity} = 1 and ${table.requiresConfirmation} = false)`
  ),
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
  ),
  check(
    'event_types_max_per_week_positive',
    sql`${table.maxPerWeek} is null or ${table.maxPerWeek} > 0`
  ),
  check(
    'event_types_max_per_month_positive',
    sql`${table.maxPerMonth} is null or ${table.maxPerMonth} > 0`
  ),
  check('event_types_capacity_range', sql`${table.capacity} between 1 and 500`),
  check(
    'event_types_payment_configuration_valid',
    sql`(${table.paymentEnabled} = false and ${table.priceCents} is null) or (${table.paymentEnabled} = true and ${table.priceCents} >= 100 and ${table.requiresConfirmation} = false)`
  ),
  check('event_types_payment_currency_allowed', sql`${table.paymentCurrency} in ('USD', 'NGN')`)
])

/**
 * Opaque, revocable capabilities for private scheduling. Only a SHA-256 hash
 * is stored so a database read cannot recover a guest's booking link.
 */
export const bookingLinks = pgTable('booking_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  kind: text('kind').notNull(),
  label: text('label'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('booking_links_token_hash_key').on(table.tokenHash),
  index('booking_links_user_created_idx').on(table.userId, table.createdAt),
  index('booking_links_event_type_idx').on(table.eventTypeId),
  check('booking_links_kind_allowed', sql`${table.kind} in ('single_use', 'one_off')`),
  check('booking_links_expiry_after_creation', sql`${table.expiresAt} > ${table.createdAt}`)
])

/** Exact choices offered by a one-off invitation. */
export const bookingLinkSlots = pgTable('booking_link_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingLinkId: uuid('booking_link_id').notNull().references(() => bookingLinks.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  ...timestamps
}, table => [
  uniqueIndex('booking_link_slots_link_start_key').on(table.bookingLinkId, table.startsAt),
  index('booking_link_slots_link_idx').on(table.bookingLinkId),
  check('booking_link_slots_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`)
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

/**
 * A managed template is a snapshot. Updating it affects only event types
 * created afterwards; existing links keep the values guests already saw.
 */
export const organizationEventTemplates = pgTable('organization_event_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  defaults: jsonb('defaults').$type<TeamEventTemplateDefaults>().notNull(),
  sourceEventTypeId: uuid('source_event_type_id').references(() => eventTypes.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('organization_event_templates_active_name_key')
    .on(table.organizationId, sql`lower(${table.name})`)
    .where(sql`${table.archivedAt} is null`),
  index('organization_event_templates_organization_archived_idx')
    .on(table.organizationId, table.archivedAt, table.createdAt)
])

export const bookingStatus = pgEnum('booking_status', [
  'awaiting_payment',
  'pending',
  'confirmed',
  'cancelled',
  'rejected'
])

/** A guest-created repeating schedule whose occurrences are ordinary bookings. */
export const bookingSeries = pgTable('booking_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'restrict' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  frequency: text('frequency').notNull(),
  occurrenceCount: integer('occurrence_count').notNull(),
  timeZone: text('time_zone').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  ...timestamps
}, table => [
  uniqueIndex('booking_series_request_id_key').on(table.requestId),
  index('booking_series_event_created_idx').on(table.eventTypeId, table.createdAt),
  index('booking_series_organization_created_idx').on(table.organizationId, table.createdAt)
    .where(sql`${table.organizationId} is not null`),
  check('booking_series_frequency_allowed', sql`${table.frequency} in ('weekly', 'biweekly', 'monthly', 'yearly')`),
  check('booking_series_occurrence_count_range', sql`${table.occurrenceCount} between 2 and 8`),
  check('booking_series_duration_positive', sql`${table.durationMinutes} > 0`)
])

/**
 * The person or team that receives paid-booking proceeds. Bachs Connect keeps
 * seller funds separate from Schedra's own balance and hosts the compliance
 * flow, so Schedra never stores identity documents or bank details.
 */
export const paymentRecipients = pgTable('payment_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  bachsAccountId: text('bachs_account_id'),
  status: text('status').notNull().default('not_started'),
  capabilities: jsonb('capabilities').$type<Record<string, { status?: string }>>().notNull().default(sql`'{}'::jsonb`),
  requirements: jsonb('requirements').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  lastError: text('last_error'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('payment_recipients_user_key').on(table.userId).where(sql`${table.userId} is not null`),
  uniqueIndex('payment_recipients_organization_key').on(table.organizationId).where(sql`${table.organizationId} is not null`),
  uniqueIndex('payment_recipients_bachs_account_key').on(table.bachsAccountId).where(sql`${table.bachsAccountId} is not null`),
  check(
    'payment_recipients_exactly_one_owner',
    sql`(${table.userId} is null) <> (${table.organizationId} is null)`
  ),
  check(
    'payment_recipients_status_allowed',
    sql`${table.status} in ('not_started', 'onboarding', 'pending_review', 'active', 'restricted', 'disabled')`
  )
])

/**
 * A user-confirmed request to move connected-account funds to an approved
 * external destination. The client supplies the UUID once and retries it,
 * while the derived provider reference is Bachs' idempotency key. This row is
 * deliberately durable before the provider call: a lost HTTP response must
 * remain reconcilable instead of inviting a second withdrawal.
 */
export const paymentWithdrawals = pgTable('payment_withdrawals', {
  id: uuid('id').primaryKey(),
  recipientId: uuid('recipient_id').notNull().references(() => paymentRecipients.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reference: text('reference').notNull(),
  bachsPayoutId: text('bachs_payout_id'),
  destinationId: text('destination_id').notNull(),
  destinationName: text('destination_name').notNull(),
  sourceCurrency: text('source_currency').notNull(),
  destinationCurrency: text('destination_currency').notNull(),
  // For same-currency payouts this is what the destination receives. For a
  // quoted cross-currency payout it is the source balance amount the user
  // confirmed. Provider-returned delivery and debit values remain separate.
  requestedAmountCents: integer('requested_amount_cents').notNull(),
  deliveredAmountCents: integer('delivered_amount_cents'),
  feeCents: integer('fee_cents'),
  totalDebitedCents: integer('total_debited_cents'),
  status: text('status').notNull().default('creating'),
  failureReason: text('failure_reason'),
  providerEventId: text('provider_event_id'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('payment_withdrawals_reference_key').on(table.reference),
  uniqueIndex('payment_withdrawals_bachs_payout_key').on(table.bachsPayoutId)
    .where(sql`${table.bachsPayoutId} is not null`),
  index('payment_withdrawals_recipient_created_idx').on(table.recipientId, table.createdAt),
  index('payment_withdrawals_status_checked_idx').on(table.status, table.lastCheckedAt),
  check(
    'payment_withdrawals_status_allowed',
    sql`${table.status} in ('creating', 'pending', 'processing', 'completed', 'failed', 'unknown')`
  ),
  check('payment_withdrawals_requested_amount_positive', sql`${table.requestedAmountCents} > 0`),
  check('payment_withdrawals_delivered_amount_positive', sql`${table.deliveredAmountCents} is null or ${table.deliveredAmountCents} > 0`),
  check('payment_withdrawals_fee_non_negative', sql`${table.feeCents} is null or ${table.feeCents} >= 0`),
  check('payment_withdrawals_total_debited_positive', sql`${table.totalDebitedCents} is null or ${table.totalDebitedCents} > 0`),
  check('payment_withdrawals_source_currency_allowed', sql`${table.sourceCurrency} in ('USD', 'NGN')`),
  check('payment_withdrawals_destination_currency_allowed', sql`${table.destinationCurrency} in ('USD', 'NGN')`)
])

/**
 * One occurrence of a seated event. Locking this row serializes seat claims,
 * while the immutable capacity snapshot prevents an event-type edit from
 * unexpectedly evicting guests who already booked.
 */
export const groupEventSessions = pgTable('group_event_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'restrict' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  capacity: integer('capacity').notNull(),
  ...timestamps
}, table => [
  uniqueIndex('group_event_sessions_event_time_key').on(table.eventTypeId, table.startsAt, table.endsAt),
  index('group_event_sessions_event_starts_idx').on(table.eventTypeId, table.startsAt),
  check('group_event_sessions_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
  check('group_event_sessions_capacity_range', sql`${table.capacity} between 2 and 500`)
])

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'restrict' }),
  groupSessionId: uuid('group_session_id').references(() => groupEventSessions.id, { onDelete: 'restrict' }),
  seriesId: uuid('series_id').references(() => bookingSeries.id, { onDelete: 'restrict' }),
  seriesPosition: integer('series_position'),
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
  index('bookings_host_created_at_idx').on(table.hostId, table.createdAt),
  index('bookings_organization_created_at_idx').on(table.organizationId, table.createdAt)
    .where(sql`${table.organizationId} is not null`),
  index('bookings_host_status_ends_at_idx').on(table.hostId, table.status, table.endsAt),
  index('bookings_event_type_id_idx').on(table.eventTypeId),
  index('bookings_group_session_status_idx').on(table.groupSessionId, table.status),
  index('bookings_series_position_idx').on(table.seriesId, table.seriesPosition),
  uniqueIndex('bookings_active_series_position_key')
    .on(table.seriesId, table.seriesPosition)
    .where(sql`${table.seriesId} is not null and ${table.status} in ('awaiting_payment', 'pending', 'confirmed')`),
  check(
    'bookings_series_fields_paired',
    sql`(${table.seriesId} is null) = (${table.seriesPosition} is null)`
  ),
  check('bookings_series_position_positive', sql`${table.seriesPosition} is null or ${table.seriesPosition} > 0`),
  check('bookings_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`)
])

/**
 * One immutable price snapshot and one provider checkout per booking. Provider
 * IDs are unique so webhook retries and redirect reconciliation converge on a
 * single row instead of fulfilling a reservation twice.
 */
export const bookingPayments = pgTable('booking_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'restrict' }),
  recipientId: uuid('recipient_id').notNull().references(() => paymentRecipients.id, { onDelete: 'restrict' }),
  reference: text('reference').notNull(),
  status: text('status').notNull().default('pending'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  platformFeeCents: integer('platform_fee_cents').notNull(),
  bachsCheckoutId: text('bachs_checkout_id'),
  bachsChargeId: text('bachs_charge_id'),
  checkoutUrl: text('checkout_url'),
  checkoutExpiresAt: timestamp('checkout_expires_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...timestamps
}, table => [
  uniqueIndex('booking_payments_booking_key').on(table.bookingId),
  uniqueIndex('booking_payments_reference_key').on(table.reference),
  uniqueIndex('booking_payments_checkout_key').on(table.bachsCheckoutId).where(sql`${table.bachsCheckoutId} is not null`),
  uniqueIndex('booking_payments_charge_key').on(table.bachsChargeId).where(sql`${table.bachsChargeId} is not null`),
  index('booking_payments_status_expiry_idx').on(table.status, table.checkoutExpiresAt),
  check(
    'booking_payments_status_allowed',
    sql`${table.status} in ('pending', 'paid', 'failed', 'expired', 'refund_pending', 'refunded', 'refund_failed')`
  ),
  check('booking_payments_amount_positive', sql`${table.amountCents} >= 100`),
  check(
    'booking_payments_platform_fee_valid',
    sql`${table.platformFeeCents} > 0 and ${table.platformFeeCents} < ${table.amountCents}`
  ),
  check('booking_payments_currency_allowed', sql`${table.currency} in ('USD', 'NGN')`)
])

/**
 * Append-only money movement and payment-attempt history. The current state
 * remains on bookingPayments for fast reads; this ledger explains how that
 * state was reached and provides the immutable evidence needed for support and
 * reconciliation. It intentionally excludes card, bank and raw webhook data.
 */
export const paymentLedgerEntries = pgTable('payment_ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingPaymentId: uuid('booking_payment_id').notNull().references(() => bookingPayments.id, { onDelete: 'restrict' }),
  dedupeKey: text('dedupe_key').notNull(),
  kind: text('kind').notNull(),
  direction: text('direction').notNull(),
  status: text('status').notNull(),
  amountCents: integer('amount_cents'),
  currency: text('currency').notNull(),
  provider: text('provider').notNull().default('bachs'),
  providerEventId: text('provider_event_id'),
  providerObjectId: text('provider_object_id'),
  message: text('message'),
  metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>().notNull().default(sql`'{}'::jsonb`),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  uniqueIndex('payment_ledger_entries_dedupe_key').on(table.dedupeKey),
  uniqueIndex('payment_ledger_entries_success_kind_key')
    .on(table.bookingPaymentId, table.kind)
    .where(sql`${table.status} = 'succeeded' and ${table.kind} in ('customer_payment', 'platform_fee', 'processing_fee', 'settlement')`),
  index('payment_ledger_entries_payment_occurred_idx').on(table.bookingPaymentId, table.occurredAt),
  index('payment_ledger_entries_status_occurred_idx').on(table.status, table.occurredAt),
  index('payment_ledger_entries_provider_event_idx').on(table.provider, table.providerEventId)
    .where(sql`${table.providerEventId} is not null`),
  check(
    'payment_ledger_entries_kind_allowed',
    sql`${table.kind} in ('checkout', 'customer_payment', 'platform_fee', 'processing_fee', 'settlement', 'refund')`
  ),
  check('payment_ledger_entries_direction_allowed', sql`${table.direction} in ('none', 'in', 'out')`),
  check('payment_ledger_entries_status_allowed', sql`${table.status} in ('pending', 'succeeded', 'failed', 'expired')`),
  check('payment_ledger_entries_amount_non_negative', sql`${table.amountCents} is null or ${table.amountCents} >= 0`),
  check('payment_ledger_entries_currency_allowed', sql`${table.currency} in ('USD', 'NGN')`),
  check('payment_ledger_entries_provider_allowed', sql`${table.provider} = 'bachs'`)
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
  groupSessionId: uuid('group_session_id').references(() => groupEventSessions.id, { onDelete: 'restrict' }),
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
  index('booking_hosts_group_session_idx').on(table.groupSessionId),
  check('booking_hosts_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`)
])

/**
 * Immutable product events are the shared foundation for automations and
 * analytics. The payload deliberately stays small; delivery reads the current
 * booking through its foreign key instead of copying sensitive form answers.
 */
export const domainEvents = pgTable('domain_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  dedupeKey: text('dedupe_key').notNull(),
  type: text('type').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  eventTypeId: uuid('event_type_id').references(() => eventTypes.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('domain_events_dedupe_key_key').on(table.dedupeKey),
  index('domain_events_dispatch_idx').on(table.dispatchedAt, table.occurredAt),
  index('domain_events_user_occurred_idx').on(table.userId, table.occurredAt),
  index('domain_events_organization_occurred_idx').on(table.organizationId, table.occurredAt),
  check(
    'domain_events_exactly_one_scope',
    sql`(${table.organizationId} is null) <> (${table.userId} is null)`
  )
])

export const automationWorkflows = pgTable('automation_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  eventTypeId: uuid('event_type_id').references(() => eventTypes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  offsetMinutes: integer('offset_minutes').notNull().default(0),
  action: jsonb('action').$type<WorkflowAction>().notNull(),
  webhookSecretEncrypted: text('webhook_secret_encrypted'),
  active: boolean('active').notNull().default(true),
  ...timestamps
}, table => [
  index('automation_workflows_user_active_idx').on(table.userId, table.active),
  index('automation_workflows_organization_active_idx').on(table.organizationId, table.active),
  index('automation_workflows_event_type_idx').on(table.eventTypeId),
  check(
    'automation_workflows_exactly_one_scope',
    sql`(${table.organizationId} is null) <> (${table.userId} is null)`
  ),
  check('automation_workflows_offset_range', sql`${table.offsetMinutes} between 0 and 10080`)
])

export const automationRunStatus = pgEnum('automation_run_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled'
])

export const automationRuns = pgTable('automation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => automationWorkflows.id, { onDelete: 'cascade' }),
  domainEventId: uuid('domain_event_id').references(() => domainEvents.id, { onDelete: 'set null' }),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  status: automationRunStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...timestamps
}, table => [
  uniqueIndex('automation_runs_workflow_booking_key').on(table.workflowId, table.bookingId),
  index('automation_runs_claim_idx').on(table.status, table.availableAt),
  index('automation_runs_booking_idx').on(table.bookingId),
  check('automation_runs_attempts_non_negative', sql`${table.attempts} >= 0`)
])

export const bookingCalendarEvents = pgTable('booking_calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  // A collective booking can have one remote event per assigned host.
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => calendarConnections.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('google'),
  calendarId: text('calendar_id').notNull(),
  eventId: text('event_id').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
}, table => [
  uniqueIndex('booking_calendar_events_booking_user_key').on(table.bookingId, table.userId),
  index('booking_calendar_events_user_id_idx').on(table.userId),
  uniqueIndex('booking_calendar_events_remote_key').on(table.provider, table.calendarId, table.eventId)
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
  revision: integer('revision').notNull().default(1),
  status: calendarSyncStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  failureProvider: text('failure_provider'),
  ...timestamps
}, table => [
  uniqueIndex('calendar_sync_jobs_dedupe_key_key').on(table.dedupeKey),
  uniqueIndex('calendar_sync_jobs_booking_id_key').on(table.bookingId),
  index('calendar_sync_jobs_claim_idx').on(table.status, table.availableAt),
  check('calendar_sync_jobs_attempts_non_negative', sql`${table.attempts} >= 0`),
  check('calendar_sync_jobs_revision_positive', sql`${table.revision} > 0`)
])

export const billingSyncStatus = pgEnum('billing_sync_status', [
  'pending',
  'processing',
  'completed',
  'failed'
])

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'processing',
  'completed',
  'ignored',
  'failed'
])

export const operationsAlertStatus = pgEnum('operations_alert_status', [
  'active',
  'acknowledged',
  'resolved'
])

/**
 * Verified provider events are retained in encrypted form so a platform
 * operator can safely retry failed processing without asking the provider to
 * resend it. Invalid signatures are deliberately not persisted: accepting
 * attacker-controlled bodies here would turn this table into free storage.
 */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  providerEventId: text('provider_event_id'),
  eventType: text('event_type').notNull(),
  status: webhookDeliveryStatus('status').notNull().default('processing'),
  attempts: integer('attempts').notNull().default(1),
  payloadEncrypted: text('payload_encrypted'),
  requestId: text('request_id'),
  lastError: text('last_error'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('webhook_deliveries_provider_event_key')
    .on(table.provider, table.providerEventId)
    .where(sql`${table.providerEventId} is not null`),
  index('webhook_deliveries_status_received_idx').on(table.status, table.receivedAt),
  index('webhook_deliveries_provider_received_idx').on(table.provider, table.receivedAt),
  check('webhook_deliveries_attempts_positive', sql`${table.attempts} > 0`)
])

/** A durable incident state prevents one broken provider from spamming email. */
export const operationsAlerts = pgTable('operations_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  type: text('type').notNull(),
  severity: text('severity').notNull(),
  status: operationsAlertStatus('status').notNull().default('active'),
  summary: text('summary').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps
}, table => [
  uniqueIndex('operations_alerts_key_key').on(table.key),
  index('operations_alerts_status_seen_idx').on(table.status, table.lastSeenAt),
  check('operations_alerts_severity_allowed', sql`${table.severity} in ('warning', 'critical')`)
])

/**
 * Short-lived database leases make scheduled work safe when several app or
 * worker instances are running. A crashed process stops heartbeating and its
 * lease becomes claimable after expiresAt.
 */
export const workerLeases = pgTable('worker_leases', {
  name: text('name').primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps
}, table => [
  index('worker_leases_expires_at_idx').on(table.expiresAt)
])

/** Worker heartbeats let readiness checks distinguish an idle queue from a dead worker. */
export const workerInstances = pgTable('worker_instances', {
  id: uuid('id').primaryKey(),
  role: text('role').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
  ...timestamps
}, table => [
  index('worker_instances_last_seen_idx').on(table.lastSeenAt),
  check('worker_instances_role_allowed', sql`${table.role} in ('worker', 'all')`)
])

/** Public qualification forms route a guest to the first matching event type. */
export const routingForms = pgTable('routing_forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  defaultEventTypeId: uuid('default_event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'restrict' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  questions: jsonb('questions').$type<Array<{
    id: string
    label: string
    options: string[]
    required: boolean
  }>>().notNull().default(sql`'[]'::jsonb`),
  ...timestamps
}, table => [
  uniqueIndex('routing_forms_user_slug_key').on(table.userId, sql`lower(${table.slug})`)
    .where(sql`${table.userId} is not null`),
  uniqueIndex('routing_forms_organization_slug_key').on(table.organizationId, sql`lower(${table.slug})`)
    .where(sql`${table.organizationId} is not null`),
  index('routing_forms_user_idx').on(table.userId, table.createdAt),
  index('routing_forms_organization_idx').on(table.organizationId, table.createdAt),
  check('routing_forms_exactly_one_owner', sql`(${table.userId} is null) <> (${table.organizationId} is null)`),
  check('routing_forms_questions_limit', sql`jsonb_array_length(${table.questions}) between 1 and 10`)
])

export const routingRules = pgTable('routing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  formId: uuid('form_id').notNull().references(() => routingForms.id, { onDelete: 'cascade' }),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  conditions: jsonb('conditions').$type<RoutingCondition[]>().notNull(),
  position: smallint('position').notNull(),
  ...timestamps
}, table => [
  uniqueIndex('routing_rules_form_position_key').on(table.formId, table.position),
  index('routing_rules_form_idx').on(table.formId),
  check('routing_rules_position_non_negative', sql`${table.position} >= 0`),
  check('routing_rules_conditions_limit', sql`jsonb_array_length(${table.conditions}) between 1 and 10`)
])

export const routingResponses = pgTable('routing_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  formId: uuid('form_id').notNull().references(() => routingForms.id, { onDelete: 'cascade' }),
  matchedRuleId: uuid('matched_rule_id').references(() => routingRules.id, { onDelete: 'set null' }),
  eventTypeId: uuid('event_type_id').notNull().references(() => eventTypes.id, { onDelete: 'restrict' }),
  respondentName: text('respondent_name').notNull(),
  respondentEmail: text('respondent_email').notNull(),
  answers: jsonb('answers').$type<Record<string, string>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('routing_responses_form_created_idx').on(table.formId, table.createdAt),
  index('routing_responses_event_created_idx').on(table.eventTypeId, table.createdAt)
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
