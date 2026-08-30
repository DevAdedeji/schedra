import { createHash, randomBytes } from 'node:crypto'
import type { CreateBookingLinkInput } from '#shared/booking-links'
import { eventTypeDurationOptions } from '#shared/validation'
import { paginationMeta } from '#shared/pagination'
import {
  createBookingLinkRecord,
  findBookingLinkByHash,
  findOwnedEventType,
  listBookingLinkRecords,
  revokeBookingLink
} from '../repositories/booking-links'
import { slotsFor } from './booking-page'
import { requireLocationIntegration } from './event-location'
import { addUtcCalendarDays, DAY_MS, utcCalendarDate } from '../utils/date-time'

const MAX_LIFETIME_MS = 90 * DAY_MS

export function bookingLinkTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createBookingLink(userId: string, input: CreateBookingLinkInput) {
  const eventType = await findOwnedEventType(userId, input.eventTypeId)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such event type.' })
  await requireLocationIntegration(eventType.hostId, eventType.locationType)

  const now = new Date()
  let expiresAt = new Date(input.expiresAt)
  if (expiresAt.getTime() <= now.getTime() + 60_000) {
    throw createError({ statusCode: 400, statusMessage: 'Choose an expiry time in the future.' })
  }
  if (expiresAt.getTime() > now.getTime() + MAX_LIFETIME_MS) {
    throw createError({ statusCode: 400, statusMessage: 'Private links can remain open for at most 90 days.' })
  }

  const selectedSlots = input.slots
    .map(slot => ({ start: new Date(slot.start), end: new Date(slot.end) }))
    .sort((left, right) => left.start.getTime() - right.start.getTime())
  if (input.kind === 'one_off') {
    const first = selectedSlots[0]!
    const last = selectedSlots.at(-1)!
    const from = addUtcCalendarDays(utcCalendarDate(first.start), -1)
    const to = addUtcCalendarDays(utcCalendarDate(last.start), 1)
    const available = await slotsFor(eventType, from, to, now.toISOString(), input.durationMinutes)
    const availableByStart = new Map(available.map(slot => [Date.parse(slot.start), Date.parse(slot.end)]))
    const invalid = selectedSlots.some(slot => availableByStart.get(slot.start.getTime()) !== slot.end.getTime())
    if (invalid) {
      throw createError({ statusCode: 409, statusMessage: 'One or more selected times are no longer available.' })
    }
    expiresAt = new Date(Math.min(expiresAt.getTime(), last.end.getTime()))
  }

  const token = randomBytes(32).toString('base64url')
  const record = await createBookingLinkRecord({
    userId,
    eventTypeId: input.eventTypeId,
    tokenHash: bookingLinkTokenHash(token),
    kind: input.kind,
    label: input.label || null,
    expiresAt,
    slots: selectedSlots
  })
  return { id: record.id, token, path: `/meeting/${token}`, expiresAt: expiresAt.toISOString() }
}

export async function resolveBookingLink(token: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null
  return findBookingLinkByHash(bookingLinkTokenHash(token))
}

export async function requireUsableBookingLink(token: string) {
  const link = await resolveBookingLink(token)
  if (!link) throw createError({ statusCode: 404, statusMessage: 'No such invitation.' })
  if (link.revokedAt || link.usedAt || link.expiresAt <= new Date()) {
    throw createError({ statusCode: 410, statusMessage: 'This invitation is no longer available.' })
  }
  return link
}

export function bookingLinkDurationOptions(link: Awaited<ReturnType<typeof requireUsableBookingLink>>) {
  if (link.kind !== 'one_off' || !link.slots.length) return eventTypeDurationOptions(link)
  return [...new Set(link.slots.map(slot => Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000)))]
}

export function filterInvitationSlots<T extends { start: string, end: string }>(link: Awaited<ReturnType<typeof requireUsableBookingLink>>, slots: T[]) {
  if (link.kind !== 'one_off') return slots
  const allowed = new Set(link.slots.map(slot => `${slot.start.getTime()}:${slot.end.getTime()}`))
  return slots.filter(slot => allowed.has(`${Date.parse(slot.start)}:${Date.parse(slot.end)}`))
}

export async function listBookingLinks(userId: string, input: {
  filter: 'all' | 'available' | 'booked' | 'closed'
  page: number
  pageSize: number
}) {
  const result = await listBookingLinkRecords({ userId, ...input })
  const now = Date.now()
  return {
    items: result.items.map(item => ({
      ...item,
      kind: item.kind as 'single_use' | 'one_off',
      status: item.usedAt
        ? 'booked' as const
        : item.revokedAt
          ? 'revoked' as const
          : item.expiresAt.getTime() <= now
            ? 'expired' as const
            : 'available' as const
    })),
    counts: result.counts,
    pagination: paginationMeta(result.total, input.page, input.pageSize)
  }
}

export async function revokeOwnedBookingLink(userId: string, id: string) {
  if (!await revokeBookingLink(userId, id)) {
    throw createError({ statusCode: 409, statusMessage: 'This link is already booked, expired or revoked.' })
  }
}
