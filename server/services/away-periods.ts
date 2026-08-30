import { Temporal } from '@js-temporal/polyfill'
import { and, asc, count, eq, gt, isNull, lt, ne } from 'drizzle-orm'
import type { AwayPeriodInput } from '#shared/away-periods'
import { awayPeriods, bookingHosts, users } from '../database/schema'
import { useDatabase } from '../database'
import { awayPeriodInterval } from '../domain/away-periods'

const MAX_AWAY_PERIODS = 100

type AwayPeriodRow = typeof awayPeriods.$inferSelect

async function periodResponses(rows: AwayPeriodRow[]) {
  if (!rows.length) return []
  const db = useDatabase()
  const periodsWithIntervals = rows.map(row => ({ row, interval: awayPeriodInterval(row) }))
  const starts = periodsWithIntervals.map(period => Date.parse(period.interval.start))
  const ends = periodsWithIntervals.map(period => Date.parse(period.interval.end))
  const reservations = await db.select({
    bookingId: bookingHosts.bookingId,
    start: bookingHosts.startsAt,
    end: bookingHosts.endsAt
  }).from(bookingHosts).where(and(
    eq(bookingHosts.userId, rows[0]!.userId),
    isNull(bookingHosts.releasedAt),
    lt(bookingHosts.startsAt, new Date(Math.max(...ends))),
    gt(bookingHosts.endsAt, new Date(Math.min(...starts)))
  ))

  return periodsWithIntervals.map(({ row, interval }) => ({
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    timeZone: row.timeZone,
    conflictingBookingCount: reservations.filter(reservation =>
      reservation.start.getTime() < Date.parse(interval.end)
      && reservation.end.getTime() > Date.parse(interval.start)
    ).length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

export async function listAwayPeriods(userId: string) {
  const db = useDatabase()
  const [rows, [user]] = await Promise.all([
    db.select().from(awayPeriods)
      .where(eq(awayPeriods.userId, userId))
      .orderBy(asc(awayPeriods.startDate), asc(awayPeriods.createdAt)),
    db.select({ timeZone: users.timeZone }).from(users).where(eq(users.id, userId)).limit(1)
  ])
  return { items: await periodResponses(rows), timeZone: user?.timeZone ?? 'UTC' }
}

async function assertDoesNotOverlap(userId: string, input: AwayPeriodInput, ignoredId?: string) {
  const [overlap] = await useDatabase().select({ id: awayPeriods.id }).from(awayPeriods)
    .where(and(
      eq(awayPeriods.userId, userId),
      ignoredId ? ne(awayPeriods.id, ignoredId) : undefined,
      lt(awayPeriods.startDate, Temporal.PlainDate.from(input.endDate).add({ days: 1 }).toString()),
      gt(awayPeriods.endDate, Temporal.PlainDate.from(input.startDate).subtract({ days: 1 }).toString())
    ))
    .limit(1)

  if (overlap) {
    throw createError({ statusCode: 409, statusMessage: 'This time off overlaps another away period.' })
  }
}

export async function createAwayPeriod(userId: string, input: AwayPeriodInput) {
  const db = useDatabase()
  const [[user], [total]] = await Promise.all([
    db.select({ timeZone: users.timeZone }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ value: count() }).from(awayPeriods).where(eq(awayPeriods.userId, userId))
  ])
  if (!user) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  if ((total?.value ?? 0) >= MAX_AWAY_PERIODS) {
    throw createError({ statusCode: 409, statusMessage: 'You can keep up to 100 away periods.' })
  }
  await assertDoesNotOverlap(userId, input)

  const [created] = await db.insert(awayPeriods).values({
    userId,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: user.timeZone
  }).returning()
  if (!created) throw new Error('Could not create away period')
  return (await periodResponses([created]))[0]!
}

export async function updateAwayPeriod(userId: string, id: string, input: AwayPeriodInput) {
  const [owned] = await useDatabase().select({ id: awayPeriods.id }).from(awayPeriods)
    .where(and(eq(awayPeriods.id, id), eq(awayPeriods.userId, userId)))
    .limit(1)
  if (!owned) return null
  await assertDoesNotOverlap(userId, input, id)
  const [updated] = await useDatabase().update(awayPeriods).set({
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate
  }).where(and(eq(awayPeriods.id, id), eq(awayPeriods.userId, userId))).returning()
  return updated ? (await periodResponses([updated]))[0]! : null
}

export async function deleteAwayPeriod(userId: string, id: string) {
  const [deleted] = await useDatabase().delete(awayPeriods)
    .where(and(eq(awayPeriods.id, id), eq(awayPeriods.userId, userId)))
    .returning({ id: awayPeriods.id })
  return Boolean(deleted)
}

export async function awayIntervalsForUser(userId: string, from: string, to: string) {
  const broadFrom = Temporal.PlainDate.from(from).subtract({ days: 2 }).toString()
  const broadTo = Temporal.PlainDate.from(to).add({ days: 2 }).toString()
  const rows = await useDatabase().select({
    startDate: awayPeriods.startDate,
    endDate: awayPeriods.endDate,
    timeZone: awayPeriods.timeZone
  }).from(awayPeriods).where(and(
    eq(awayPeriods.userId, userId),
    lt(awayPeriods.startDate, Temporal.PlainDate.from(broadTo).add({ days: 1 }).toString()),
    gt(awayPeriods.endDate, Temporal.PlainDate.from(broadFrom).subtract({ days: 1 }).toString())
  ))
  return rows.map(awayPeriodInterval)
}
