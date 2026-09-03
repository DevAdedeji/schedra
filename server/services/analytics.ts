import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { fillDailySeries, percentage, percentageChange, type AnalyticsQuery } from '#shared/analytics'
import { bookingHosts, bookingPayments, bookings, eventTypes } from '../database/schema'
import { useDatabase } from '../database'
import { subtractFromInstant } from '../utils/date-time'

export type AnalyticsOwner
  = | { userId: string, organizationId?: never, visibleUserId?: never }
    | { organizationId: string, visibleUserId?: string, userId?: never }

function scope(owner: AnalyticsOwner) {
  if ('userId' in owner && owner.userId) return eq(eventTypes.userId, owner.userId)
  const assigned = owner.visibleUserId
    ? sql`exists (
        select 1 from ${bookingHosts}
        where ${bookingHosts.bookingId} = ${bookings.id}
          and ${bookingHosts.userId} = ${owner.visibleUserId}
      )`
    : undefined
  return and(eq(bookings.organizationId, owner.organizationId!), assigned)
}

function periodWhere(owner: AnalyticsOwner, from: Date, to: Date, eventTypeId?: string) {
  return and(
    scope(owner),
    gte(bookings.createdAt, from),
    lt(bookings.createdAt, to),
    eventTypeId ? eq(bookings.eventTypeId, eventTypeId) : undefined
  )
}

const realBooking = sql`${bookings.status} <> 'awaiting_payment'`
const cancelledBooking = sql`${bookings.status} in ('cancelled', 'rejected')`

export async function getBookingAnalytics(
  owner: AnalyticsOwner,
  query: AnalyticsQuery,
  capabilities: { includeRevenue?: boolean } = { includeRevenue: true }
) {
  const db = useDatabase()
  const to = new Date()
  const from = subtractFromInstant(to, { hours: query.days * 24 })
  const previousFrom = subtractFromInstant(from, { hours: query.days * 24 })
  const current = periodWhere(owner, from, to, query.eventTypeId)
  const previous = periodWhere(owner, previousFrom, from, query.eventTypeId)

  const [[summary], [prior], dailyRows, sourceRows, eventRows, revenueRows, options] = await Promise.all([
    db.select({
      total: sql<number>`count(*) filter (where ${realBooking})`.mapWith(Number),
      confirmed: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${bookings.status} = 'pending')`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${cancelledBooking})`.mapWith(Number),
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.endsAt} < now() and ${bookings.attendanceStatus} is distinct from 'no_show')`.mapWith(Number),
      noShows: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.endsAt} < now() and ${bookings.attendanceStatus} = 'no_show')`.mapWith(Number),
      averageLeadHours: sql<number>`coalesce(avg(extract(epoch from (${bookings.startsAt} - ${bookings.createdAt})) / 3600) filter (where ${realBooking} and ${bookings.startsAt} > ${bookings.createdAt}), 0)`.mapWith(Number)
    }).from(bookings).innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId)).where(current),
    db.select({
      total: sql<number>`count(*) filter (where ${realBooking})`.mapWith(Number),
      confirmed: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number)
    }).from(bookings).innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId)).where(previous),
    db.select({
      date: sql<string>`to_char(date_trunc('day', ${bookings.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      value: sql<number>`count(*) filter (where ${realBooking})`.mapWith(Number)
    }).from(bookings).innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .where(current)
      .groupBy(sql`date_trunc('day', ${bookings.createdAt} at time zone 'UTC')`)
      .orderBy(asc(sql`date_trunc('day', ${bookings.createdAt} at time zone 'UTC')`)),
    db.select({
      source: bookings.source,
      value: sql<number>`count(*) filter (where ${realBooking})`.mapWith(Number)
    }).from(bookings).innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .where(current).groupBy(bookings.source),
    db.select({
      id: eventTypes.id,
      title: eventTypes.title,
      total: sql<number>`count(*) filter (where ${realBooking})`.mapWith(Number),
      confirmed: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${cancelledBooking})`.mapWith(Number),
      noShows: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.endsAt} < now() and ${bookings.attendanceStatus} = 'no_show')`.mapWith(Number),
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.endsAt} < now() and ${bookings.attendanceStatus} is distinct from 'no_show')`.mapWith(Number)
    }).from(bookings).innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .where(current).groupBy(eventTypes.id, eventTypes.title)
      .orderBy(desc(sql`count(*) filter (where ${realBooking})`)).limit(10),
    capabilities.includeRevenue
      ? db.select({
          currency: bookingPayments.currency,
          amountCents: sql<number>`coalesce(sum(${bookingPayments.amountCents}) filter (where ${bookingPayments.status} = 'paid'), 0)`.mapWith(Number)
        }).from(bookings)
          .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
          .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
          .where(current).groupBy(bookingPayments.currency)
      : Promise.resolve([]),
    db.select({ id: eventTypes.id, title: eventTypes.title })
      .from(eventTypes)
      .where(and(
        'userId' in owner && owner.userId
          ? eq(eventTypes.userId, owner.userId)
          : eq(eventTypes.organizationId, owner.organizationId!),
        eq(eventTypes.hidden, false)
      )).orderBy(asc(eventTypes.title))
  ])

  const total = summary?.total ?? 0
  const cancelled = summary?.cancelled ?? 0
  const completed = summary?.completed ?? 0
  const noShows = summary?.noShows ?? 0
  const hosted = sourceRows.find(row => row.source === 'hosted')?.value ?? 0
  const embed = sourceRows.find(row => row.source === 'embed')?.value ?? 0

  return {
    range: { days: query.days, from: from.toISOString(), to: to.toISOString() },
    scope: 'visibleUserId' in owner && owner.visibleUserId ? 'mine' : ('organizationId' in owner ? 'team' : 'personal'),
    summary: {
      total,
      confirmed: summary?.confirmed ?? 0,
      pending: summary?.pending ?? 0,
      cancelled,
      completed,
      noShows,
      noShowRate: percentage(noShows, completed + noShows),
      cancellationRate: percentage(cancelled, total),
      completionRate: percentage(completed, completed + cancelled + noShows),
      averageLeadHours: Math.round((summary?.averageLeadHours ?? 0) * 10) / 10,
      totalChange: percentageChange(total, prior?.total ?? 0),
      confirmedChange: percentageChange(summary?.confirmed ?? 0, prior?.confirmed ?? 0)
    },
    daily: fillDailySeries(from, query.days, dailyRows),
    sources: { hosted, embed },
    revenue: revenueRows.map(row => ({ currency: row.currency as 'USD' | 'NGN', amountCents: row.amountCents })),
    eventTypes: eventRows.map(row => ({
      id: row.id,
      title: row.title,
      total: row.total,
      confirmed: row.confirmed,
      cancelled: row.cancelled,
      noShows: row.noShows,
      cancellationRate: percentage(row.cancelled, row.total),
      noShowRate: percentage(row.noShows, row.completed + row.noShows)
    })),
    options
  }
}
