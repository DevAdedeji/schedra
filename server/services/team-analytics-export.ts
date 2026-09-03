import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { AnalyticsQuery } from '#shared/analytics'
import { bookingHosts, bookingPayments, bookings, eventTypes } from '../database/schema'
import { useDatabase } from '../database'
import type { Database } from '../database/client'
import { subtractFromInstant } from '../utils/date-time'

export async function teamAnalyticsExportRows(
  owner: { organizationId: string, visibleUserId?: string },
  query: AnalyticsQuery,
  options: { now?: Date, executor?: Database } = {}
) {
  const db = options.executor ?? useDatabase()
  const from = subtractFromInstant(options.now ?? new Date(), { hours: query.days * 24 })
  return db.select({
    bookingId: bookings.uid,
    createdAt: bookings.createdAt,
    startsAt: bookings.startsAt,
    endsAt: bookings.endsAt,
    status: bookings.status,
    attendanceStatus: bookings.attendanceStatus,
    eventType: eventTypes.title,
    attendeeName: bookings.attendeeName,
    attendeeEmail: bookings.attendeeEmail,
    attendeeTimeZone: bookings.attendeeTimeZone,
    source: bookings.source,
    paymentStatus: bookingPayments.status,
    amountCents: bookingPayments.amountCents,
    currency: bookingPayments.currency,
    platformFeeCents: bookingPayments.platformFeeCents
  }).from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .leftJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .where(and(
      eq(bookings.organizationId, owner.organizationId),
      gte(bookings.createdAt, from),
      query.eventTypeId ? eq(bookings.eventTypeId, query.eventTypeId) : undefined,
      owner.visibleUserId
        ? sql`exists (
            select 1 from ${bookingHosts}
            where ${bookingHosts.bookingId} = ${bookings.id}
              and ${bookingHosts.userId} = ${owner.visibleUserId}
          )`
        : undefined
    ))
    .orderBy(desc(bookings.createdAt))
    .limit(10_000)
}
