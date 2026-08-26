import { z } from 'zod'

/**
 * Personal teams stay free forever — they are the funnel. Organizations
 * are billed per occupied seat, so adding a member never blocks on a purchased
 * seat count. A joined member updates card subscriptions immediately with
 * proration; pending invitations remain free.
 */
export const TEAM_PLAN = {
  currency: 'USD',
  monthlyCentsPerSeat: 800,
  yearlyCentsPerSeat: 8000,
  minimumSeats: 1,
  trialDays: 14,
  trialSeatLimit: 10,
  graceDays: 7,
  invitationExpiryDays: 7,
  maxSeats: 100
} as const

/**
 * Bachs cannot silently re-charge a bank transfer, and NGN collection is
 * primarily bank transfer, so every renewal is invoice → pay → extend rather
 * than a card charged on file. Annual is the default for that reason: one
 * payment a year instead of twelve, and one processing fee instead of twelve.
 */
export const billingIntervals = ['yearly', 'monthly'] as const
export type BillingInterval = typeof billingIntervals[number]
export const DEFAULT_BILLING_INTERVAL: BillingInterval = 'yearly'

/**
 * Mirrors Bachs' subscription lifecycle so a webhook can be mapped straight
 * across. `past_due` still has access while Bachs retries the card; `unpaid`
 * means retries are exhausted.
 */
export const organizationPlanStatuses = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceled'
] as const
export type OrganizationPlanStatus = typeof organizationPlanStatuses[number]

/** Currencies a customer may pay in. Prices are always quoted in USD. */
export const collectionCurrencies = ['USD', 'NGN'] as const
export type CollectionCurrency = typeof collectionCurrencies[number]

/**
 * Bachs subscriptions are USD-only today, and only a saved card can be charged
 * automatically. Paying in NGN therefore means a fresh invoice each period.
 */
export const collectionMethods = ['charge_automatically', 'invoice'] as const
export type CollectionMethod = typeof collectionMethods[number]

export function collectionMethodFor(currency: CollectionCurrency): CollectionMethod {
  return currency === 'USD' ? 'charge_automatically' : 'invoice'
}

export type BillingCheckoutReason = 'activate' | 'restart' | 'manual_seat_change' | 'manual_renewal'

/**
 * Checkout creates a new payment commitment, so it must never be offered for
 * a provider-managed subscription that is already active or being recovered.
 */
export function billingCheckoutReason(
  status: OrganizationPlanStatus,
  collectionMethod: CollectionMethod,
  seatMismatch: boolean
): BillingCheckoutReason | null {
  if (status === 'trialing') return 'activate'
  if (status === 'canceled') return 'restart'
  if (collectionMethod === 'charge_automatically') return null
  if (status === 'active') return seatMismatch ? 'manual_seat_change' : null
  return 'manual_renewal'
}

export interface OrganizationEntitlement {
  status: OrganizationPlanStatus
  interval: BillingInterval
  seatsUsed: number
  /** Occupied-seat billing has no purchased cap; this is the trial or hard ceiling. */
  seatLimit: number
  canAddMembers: boolean
  /** Readable and exportable, but no new bookings on team event types. */
  readOnly: boolean
  trialEndsAt: string | null
  graceEndsAt: string | null
  currentPeriodEnd: string | null
  daysLeftInTrial: number | null
  nextInvoiceCents: number
  /** True when Bachs renews this on a saved card without anyone acting. */
  autoRenews: boolean
}

export function seatPriceCents(interval: BillingInterval) {
  return interval === 'yearly' ? TEAM_PLAN.yearlyCentsPerSeat : TEAM_PLAN.monthlyCentsPerSeat
}

/** Every team has an owner, so occupied-seat billing starts at one seat. */
export function billableSeats(seatsUsed: number) {
  return Math.max(TEAM_PLAN.minimumSeats, seatsUsed)
}

export function invoiceTotalCents(seatsUsed: number, interval: BillingInterval) {
  return billableSeats(seatsUsed) * seatPriceCents(interval)
}

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

/**
 * Bachs takes money as a decimal string at the currency's precision — never
 * minor units, never a float. Convert only at the provider boundary.
 */
export function toDecimalString(cents: number) {
  if (!Number.isFinite(cents)) throw new Error(`Invalid amount: ${cents}`)
  return (Math.round(cents) / 100).toFixed(2)
}

export function fromDecimalString(amount: string | number | null | undefined) {
  if (amount == null) return 0
  const parsed = typeof amount === 'number' ? amount : Number.parseFloat(amount)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

export const RESERVED_ORGANIZATION_SLUGS = new Set([
  'about', 'admin', 'api', 'app', 'billing', 'checkout', 'docs', 'help', 'invite',
  'login', 'new', 'pricing', 'privacy', 'schedra', 'settings', 'signup', 'support',
  't', 'team', 'teams', 'terms', 'w', 'workspaces', 'www'
])

export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'At least 2 characters')
  .max(40, 'At most 40 characters')
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Letters, numbers and hyphens only, starting with a letter or number')
  .refine(value => !value.endsWith('-'), 'Cannot end with a hyphen')
  .refine(value => !value.includes('--'), 'Cannot contain two hyphens in a row')
  .refine(value => !RESERVED_ORGANIZATION_SLUGS.has(value), 'That one is reserved')

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, 'At least 2 characters')
  .max(60, 'At most 60 characters')

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  slug: organizationSlugSchema
})

export const updateOrganizationSchema = z.object({
  name: organizationNameSchema,
  slug: organizationSlugSchema
})

export const organizationRoles = ['owner', 'admin', 'member'] as const
export type OrganizationRole = typeof organizationRoles[number]

/** Owner is never grantable by invitation — only by transfer. */
export const invitableRoles = ['admin', 'member'] as const
export type InvitableRole = typeof invitableRoles[number]

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(320, 'At most 320 characters')
    .pipe(z.email('That does not look like an email address'))
    .transform(value => value.toLowerCase()),
  role: z.enum(invitableRoles).default('member')
})

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
