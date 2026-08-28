import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { bookingLinks, bookingLinkSlots, eventTypes, schedules, users } from '../database/schema'
import { useDatabase } from '../database'

type Executor = Pick<ReturnType<typeof useDatabase>, 'select' | 'insert' | 'update'>

const eventSelection = {
  id: eventTypes.id,
  hostId: users.id,
  hostName: users.name,
  hostEmail: users.email,
  hostTimeZone: users.timeZone,
  username: users.username,
  slug: eventTypes.slug,
  title: eventTypes.title,
  description: eventTypes.description,
  durationMinutes: eventTypes.durationMinutes,
  incrementMinutes: eventTypes.incrementMinutes,
  bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
  bufferAfterMinutes: eventTypes.bufferAfterMinutes,
  minimumNoticeMinutes: eventTypes.minimumNoticeMinutes,
  bookingWindowDays: eventTypes.bookingWindowDays,
  maxPerDay: eventTypes.maxPerDay,
  locationType: eventTypes.locationType,
  locationDetails: eventTypes.locationDetails,
  reminderMinutes: eventTypes.reminderMinutes,
  bookingQuestions: eventTypes.bookingQuestions,
  requiresConfirmation: eventTypes.requiresConfirmation,
  capacity: eventTypes.capacity,
  paymentEnabled: eventTypes.paymentEnabled,
  priceCents: eventTypes.priceCents,
  paymentCurrency: eventTypes.paymentCurrency,
  scheduleId: eventTypes.scheduleId,
  scheduleTimeZone: schedules.timeZone
}

export async function findOwnedEventType(userId: string, eventTypeId: string) {
  const [row] = await useDatabase()
    .select(eventSelection)
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .leftJoin(schedules, eq(schedules.id, eventTypes.scheduleId))
    .where(and(eq(eventTypes.id, eventTypeId), eq(eventTypes.userId, userId)))
    .limit(1)
  return row ?? null
}

export function bookingLinkEventOptions(userId: string) {
  return useDatabase().select({
    id: eventTypes.id,
    title: eventTypes.title,
    slug: eventTypes.slug,
    durationMinutes: eventTypes.durationMinutes,
    locationType: eventTypes.locationType,
    hidden: eventTypes.hidden
  }).from(eventTypes)
    .where(eq(eventTypes.userId, userId))
    .orderBy(asc(eventTypes.title), asc(eventTypes.id))
}

export async function createBookingLinkRecord(input: {
  userId: string
  eventTypeId: string
  tokenHash: string
  kind: 'single_use' | 'one_off'
  label: string | null
  expiresAt: Date
  slots: Array<{ start: Date, end: Date }>
}) {
  return useDatabase().transaction(async (tx) => {
    const [created] = await tx.insert(bookingLinks).values({
      userId: input.userId,
      eventTypeId: input.eventTypeId,
      tokenHash: input.tokenHash,
      kind: input.kind,
      label: input.label,
      expiresAt: input.expiresAt
    }).returning({ id: bookingLinks.id })
    if (!created) throw new Error('Booking link insert did not return a record.')
    if (input.slots.length) {
      await tx.insert(bookingLinkSlots).values(input.slots.map(slot => ({
        bookingLinkId: created.id,
        startsAt: slot.start,
        endsAt: slot.end
      })))
    }
    return created
  })
}

export async function findBookingLinkByHash(tokenHash: string) {
  const [row] = await useDatabase()
    .select({
      linkId: bookingLinks.id,
      linkUserId: bookingLinks.userId,
      kind: bookingLinks.kind,
      label: bookingLinks.label,
      expiresAt: bookingLinks.expiresAt,
      usedAt: bookingLinks.usedAt,
      revokedAt: bookingLinks.revokedAt,
      ...eventSelection
    })
    .from(bookingLinks)
    .innerJoin(eventTypes, eq(eventTypes.id, bookingLinks.eventTypeId))
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .leftJoin(schedules, eq(schedules.id, eventTypes.scheduleId))
    .where(and(eq(bookingLinks.tokenHash, tokenHash), eq(users.emailVerified, true)))
    .limit(1)
  if (!row) return null
  const slots = row.kind === 'one_off'
    ? await useDatabase().select({ start: bookingLinkSlots.startsAt, end: bookingLinkSlots.endsAt })
        .from(bookingLinkSlots)
        .where(eq(bookingLinkSlots.bookingLinkId, row.linkId))
        .orderBy(bookingLinkSlots.startsAt)
    : []
  return { ...row, slots }
}

export async function claimBookingLink(tokenHash: string, eventTypeId: string, executor: Executor) {
  const [claimed] = await executor.update(bookingLinks)
    .set({ usedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      eq(bookingLinks.tokenHash, tokenHash),
      eq(bookingLinks.eventTypeId, eventTypeId),
      sql`${bookingLinks.usedAt} is null`,
      sql`${bookingLinks.revokedAt} is null`,
      sql`${bookingLinks.expiresAt} > now()`
    ))
    .returning({ id: bookingLinks.id })
  return Boolean(claimed)
}

export async function revokeBookingLink(userId: string, id: string) {
  const [revoked] = await useDatabase().update(bookingLinks)
    .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      eq(bookingLinks.id, id),
      eq(bookingLinks.userId, userId),
      sql`${bookingLinks.usedAt} is null`,
      sql`${bookingLinks.revokedAt} is null`
    ))
    .returning({ id: bookingLinks.id })
  return Boolean(revoked)
}

export async function listBookingLinkRecords(input: {
  userId: string
  filter: 'all' | 'available' | 'booked' | 'closed'
  page: number
  pageSize: number
}) {
  const state = input.filter === 'available'
    ? and(sql`${bookingLinks.usedAt} is null`, sql`${bookingLinks.revokedAt} is null`, sql`${bookingLinks.expiresAt} > now()`)
    : input.filter === 'booked'
      ? sql`${bookingLinks.usedAt} is not null`
      : input.filter === 'closed'
        ? sql`${bookingLinks.usedAt} is null and (${bookingLinks.revokedAt} is not null or ${bookingLinks.expiresAt} <= now())`
        : undefined
  const where = and(eq(bookingLinks.userId, input.userId), state)
  const db = useDatabase()
  const [[total], [counts], items] = await Promise.all([
    db.select({ value: count() }).from(bookingLinks).where(where),
    db.select({
      all: count(),
      available: sql<number>`count(*) filter (where ${bookingLinks.usedAt} is null and ${bookingLinks.revokedAt} is null and ${bookingLinks.expiresAt} > now())`.mapWith(Number),
      booked: sql<number>`count(*) filter (where ${bookingLinks.usedAt} is not null)`.mapWith(Number),
      closed: sql<number>`count(*) filter (where ${bookingLinks.usedAt} is null and (${bookingLinks.revokedAt} is not null or ${bookingLinks.expiresAt} <= now()))`.mapWith(Number)
    }).from(bookingLinks).where(eq(bookingLinks.userId, input.userId)),
    db.select({
      id: bookingLinks.id,
      kind: bookingLinks.kind,
      label: bookingLinks.label,
      eventTypeId: eventTypes.id,
      eventTitle: eventTypes.title,
      eventSlug: eventTypes.slug,
      expiresAt: bookingLinks.expiresAt,
      usedAt: bookingLinks.usedAt,
      revokedAt: bookingLinks.revokedAt,
      createdAt: bookingLinks.createdAt
    }).from(bookingLinks)
      .innerJoin(eventTypes, eq(eventTypes.id, bookingLinks.eventTypeId))
      .where(where)
      .orderBy(desc(bookingLinks.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
  ])
  return { total: total?.value ?? 0, counts: counts ?? { all: 0, available: 0, booked: 0, closed: 0 }, items }
}
