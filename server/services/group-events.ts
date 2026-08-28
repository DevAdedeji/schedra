import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import { bookingHosts, bookings, groupEventSessions } from '../database/schema'
import { useDatabase } from '../database'

type GroupExecutor = Pick<Database, 'select' | 'insert'>

export class GroupSessionFullError extends Error {
  constructor() {
    super('That group session has just filled up.')
    this.name = 'GroupSessionFullError'
  }
}

export function isGroupSessionFullError(error: unknown) {
  return error instanceof GroupSessionFullError
    || ((error as { code?: string, message?: string }).code === '23514'
      && String((error as { message?: string }).message).includes('Group session capacity reached'))
}

function activeSeatCondition() {
  return inArray(bookings.status, ['pending', 'confirmed'])
}

export async function groupSessionCapacity(
  eventTypeId: string,
  from: Date,
  to: Date,
  executor: Pick<Database, 'select'> = useDatabase()
) {
  const rows = await executor.select({
    id: groupEventSessions.id,
    startsAt: groupEventSessions.startsAt,
    endsAt: groupEventSessions.endsAt,
    capacity: groupEventSessions.capacity,
    occupiedSeats: sql<number>`coalesce(sum(1 + jsonb_array_length(${bookings.additionalGuestEmails})), 0)`.mapWith(Number)
  }).from(groupEventSessions)
    .leftJoin(bookings, and(
      eq(bookings.groupSessionId, groupEventSessions.id),
      activeSeatCondition()
    ))
    .where(and(
      eq(groupEventSessions.eventTypeId, eventTypeId),
      gte(groupEventSessions.endsAt, from),
      lte(groupEventSessions.startsAt, to)
    ))
    .groupBy(groupEventSessions.id)

  return rows.map(row => ({
    ...row,
    occupiedSeats: Number(row.occupiedSeats),
    availableSeats: Math.max(0, row.capacity - Number(row.occupiedSeats))
  }))
}

/**
 * Claiming a seat locks one stable session row. The unique time key handles
 * the first-booking race; the row lock handles every later seat race.
 */
export async function claimGroupSession(
  input: { eventTypeId: string, startsAt: Date, endsAt: Date, capacity: number, partySize: number },
  executor: GroupExecutor
) {
  const { partySize, ...sessionInput } = input
  await executor.insert(groupEventSessions).values(sessionInput).onConflictDoNothing({
    target: [groupEventSessions.eventTypeId, groupEventSessions.startsAt, groupEventSessions.endsAt]
  })

  const [session] = await executor.select().from(groupEventSessions)
    .where(and(
      eq(groupEventSessions.eventTypeId, input.eventTypeId),
      eq(groupEventSessions.startsAt, input.startsAt),
      eq(groupEventSessions.endsAt, input.endsAt)
    ))
    .limit(1)
    .for('update')

  if (!session) throw new Error('The group session could not be created.')

  const [seatCount] = await executor.select({
    value: sql<number>`coalesce(sum(1 + jsonb_array_length(${bookings.additionalGuestEmails})), 0)`.mapWith(Number)
  }).from(bookings)
    .where(and(eq(bookings.groupSessionId, session.id), activeSeatCondition()))

  const occupiedSeats = Number(seatCount?.value ?? 0)
  if (occupiedSeats + partySize > session.capacity) throw new GroupSessionFullError()
  return { ...session, occupiedSeats }
}

/** The oldest seat owns external calendar and conference mappings permanently. */
export async function canonicalBookingId(
  bookingId: string,
  executor: Pick<Database, 'select'> = useDatabase()
) {
  const [booking] = await executor.select({ groupSessionId: bookings.groupSessionId })
    .from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  if (!booking?.groupSessionId) return bookingId

  const [canonical] = await executor.select({ id: bookings.id }).from(bookings)
    .where(eq(bookings.groupSessionId, booking.groupSessionId))
    .orderBy(asc(bookings.createdAt), asc(bookings.id))
    .limit(1)

  return canonical?.id ?? bookingId
}

export async function confirmedGroupSeats(
  groupSessionId: string,
  executor: Pick<Database, 'select'> = useDatabase()
) {
  return executor.select({
    id: bookings.id,
    uid: bookings.uid,
    attendeeName: bookings.attendeeName,
    attendeeEmail: bookings.attendeeEmail,
    additionalGuestEmails: bookings.additionalGuestEmails,
    meetingUrl: bookings.meetingUrl,
    answers: bookings.answers
  }).from(bookings)
    .where(and(eq(bookings.groupSessionId, groupSessionId), eq(bookings.status, 'confirmed')))
    .orderBy(asc(bookings.createdAt), asc(bookings.id))
}

export async function assignedHostsForGroupSessions(
  sessionIds: string[],
  executor: Pick<Database, 'select'> = useDatabase()
) {
  if (!sessionIds.length) return []
  return executor.select({
    groupSessionId: bookingHosts.groupSessionId,
    userId: bookingHosts.userId
  }).from(bookingHosts).where(and(
    inArray(bookingHosts.groupSessionId, sessionIds),
    isNull(bookingHosts.releasedAt)
  )).groupBy(bookingHosts.groupSessionId, bookingHosts.userId)
}
