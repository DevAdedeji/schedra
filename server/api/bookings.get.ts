import { and, asc, count, desc, eq, gte, ilike, lt, lte, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import { bookings, eventTypes } from '../database/schema'
import { useDatabase } from '../utils/database'
import { requireAuthSession } from '../utils/session'
import { readBookingAnswers } from '../utils/booking-answers'

const querySchema = paginationQuerySchema.extend({
  filter: z.enum(['all', 'upcoming', 'past', 'cancelled']).default('upcoming')
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid booking filters.' })

  const { page, pageSize, search, filter } = parsed.data
  const now = new Date()
  const nextWeek = new Date(now.getTime() + 7 * 86_400_000)
  const db = useDatabase()
  const mine = eq(bookings.hostId, session.user.id)
  const active = ne(bookings.status, 'cancelled')
  const scope = filter === 'upcoming'
    ? and(gte(bookings.endsAt, now), active)
    : filter === 'past'
      ? and(lt(bookings.endsAt, now), active)
      : filter === 'cancelled'
        ? eq(bookings.status, 'cancelled')
        : undefined
  const matchesSearch = search
    ? or(
        ilike(bookings.attendeeName, `%${search}%`),
        ilike(bookings.attendeeEmail, `%${search}%`),
        ilike(eventTypes.title, `%${search}%`)
      )
    : undefined
  const where = and(mine, scope, matchesSearch)
  const upcomingCount = and(active, gte(bookings.endsAt, now))
  const pastCount = and(active, lt(bookings.endsAt, now))
  const nextWeekCount = and(active, gte(bookings.startsAt, now), lte(bookings.startsAt, nextWeek))

  const columns = {
    uid: bookings.uid,
    status: bookings.status,
    startsAt: bookings.startsAt,
    endsAt: bookings.endsAt,
    attendeeName: bookings.attendeeName,
    attendeeEmail: bookings.attendeeEmail,
    attendeeTimeZone: bookings.attendeeTimeZone,
    locationType: bookings.locationType,
    locationDetails: bookings.locationDetails,
    meetingUrl: bookings.meetingUrl,
    answers: bookings.answers,
    cancellationReason: bookings.cancellationReason,
    eventTitle: eventTypes.title
  }

  const [[totalRow], [countRow], rows] = await Promise.all([
    db.select({ value: count() }).from(bookings).innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId)).where(where),
    db.select({
      all: count(),
      upcoming: sql<number>`count(*) filter (where ${upcomingCount})`.mapWith(Number),
      past: sql<number>`count(*) filter (where ${pastCount})`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled')`.mapWith(Number),
      nextWeek: sql<number>`count(*) filter (where ${nextWeekCount})`.mapWith(Number)
    }).from(bookings).where(mine),
    db.select(columns).from(bookings)
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .where(where)
      .orderBy(filter === 'upcoming' ? asc(bookings.startsAt) : desc(bookings.startsAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  const items = rows.map((row) => {
    const answerSnapshot = readBookingAnswers(row.answers)
    return {
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      notes: answerSnapshot.notes ?? null,
      answers: undefined
    }
  })

  return {
    items,
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize),
    counts: {
      all: countRow?.all ?? 0,
      upcoming: countRow?.upcoming ?? 0,
      past: countRow?.past ?? 0,
      cancelled: countRow?.cancelled ?? 0,
      nextWeek: countRow?.nextWeek ?? 0
    }
  }
})
