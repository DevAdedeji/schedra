import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import { bookingHosts, bookings, eventTypes, users } from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { organizationAccessRoles } from '#shared/organization-access'
import { requireOrganization } from '../../../services/organization'

const querySchema = paginationQuerySchema.extend({
  filter: z.enum(['upcoming', 'pending', 'past', 'cancelled']).default('upcoming')
})

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganization(event, slug)

  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid booking filters.' })

  const { page, pageSize, search, filter } = parsed.data
  const db = useDatabase()
  const now = new Date()

  // Owners and admins see the whole team's calendar; a member sees only the
  // meetings they are actually on.
  const seesEverything = organizationAccessRoles[context.role].authorize({ booking: ['viewAll'] }).success
  const mine = sql`exists (
    select 1 from ${bookingHosts}
    where ${bookingHosts.bookingId} = ${bookings.id}
      and ${bookingHosts.userId} = ${context.userId}
  )`

  const scope = filter === 'upcoming'
    ? and(gte(bookings.endsAt, now), inArray(bookings.status, ['pending', 'confirmed']))
    : filter === 'pending'
      ? and(eq(bookings.status, 'pending'), gte(bookings.endsAt, now))
      : filter === 'past'
        ? and(lt(bookings.endsAt, now), inArray(bookings.status, ['pending', 'confirmed']))
        : inArray(bookings.status, ['cancelled', 'rejected'])

  const matchesSearch = search
    ? or(
        ilike(bookings.attendeeName, `%${search}%`),
        ilike(bookings.attendeeEmail, `%${search}%`),
        ilike(eventTypes.title, `%${search}%`)
      )
    : undefined

  const where = and(
    eq(bookings.organizationId, context.organization.id),
    seesEverything ? undefined : mine,
    scope,
    matchesSearch
  )

  const visible = and(
    eq(bookings.organizationId, context.organization.id),
    seesEverything ? undefined : mine
  )

  const [[totalRow], [countRow], items] = await Promise.all([
    db.select({ value: count() }).from(bookings)
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId)).where(where),
    db.select({
      upcoming: sql<number>`count(*) filter (where ${bookings.endsAt} >= now() and ${bookings.status} in ('pending','confirmed'))`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${bookings.status} = 'pending' and ${bookings.endsAt} >= now())`.mapWith(Number),
      past: sql<number>`count(*) filter (where ${bookings.endsAt} < now() and ${bookings.status} in ('pending','confirmed'))`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${bookings.status} in ('cancelled','rejected'))`.mapWith(Number)
    }).from(bookings).where(visible),
    db.select({
      uid: bookings.uid,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      attendeeName: bookings.attendeeName,
      attendeeEmail: bookings.attendeeEmail,
      eventTitle: eventTypes.title,
      assignmentMode: eventTypes.assignmentMode,
      locationType: bookings.locationType,
      meetingUrl: bookings.meetingUrl,
      cancellationReason: bookings.cancellationReason
    }).from(bookings)
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .where(where)
      .orderBy(filter === 'past' || filter === 'cancelled' ? desc(bookings.startsAt) : bookings.startsAt)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  // Who is actually on each meeting, which for a collective event is several.
  const uids = items.map(item => item.uid)
  const hosts = uids.length
    ? await db.select({
        uid: bookings.uid,
        name: users.name,
        isOrganizer: bookingHosts.isOrganizer,
        released: sql<boolean>`${bookingHosts.releasedAt} is not null`.mapWith(Boolean)
      }).from(bookingHosts)
        .innerJoin(bookings, eq(bookings.id, bookingHosts.bookingId))
        .innerJoin(users, eq(users.id, bookingHosts.userId))
        .where(inArray(bookings.uid, uids))
    : []

  return {
    items: items.map(item => ({
      ...item,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      hosts: hosts.filter(host => host.uid === item.uid).map(host => ({
        name: host.name,
        isOrganizer: host.isOrganizer
      }))
    })),
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize),
    counts: {
      upcoming: countRow?.upcoming ?? 0,
      pending: countRow?.pending ?? 0,
      past: countRow?.past ?? 0,
      cancelled: countRow?.cancelled ?? 0
    },
    scope: seesEverything ? 'team' : 'mine'
  }
})
