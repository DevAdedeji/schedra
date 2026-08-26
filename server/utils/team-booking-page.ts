import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { AssignmentMode, BookingQuestion } from '#shared/validation'
import { getAvailableSlots } from '../domain/availability'
import { combineHostSlots, pickRoundRobinHost, type HostLoad, type TeamSlot } from '../domain/team-availability'
import type { AvailabilityRule, DateOverride, Weekday } from '../domain/types'
import {
  availabilityRules,
  bookingHosts,
  bookings,
  dateOverrides,
  eventTypeHosts,
  eventTypes,
  members,
  schedules,
  users
} from '../database/schema'
import { useDatabase } from './database'
import { calendarBusyTimes } from './calendar-providers'
import { organizationEntitlement } from './entitlement'
import { findOrganizationBySlug } from './organization'

/** `HH:MM:SS` from Postgres `time`, trimmed to what the engine expects. */
function wall(value: string) {
  return value.slice(0, 5)
}

export interface PublicTeamEventType {
  id: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  incrementMinutes: number | null
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minimumNoticeMinutes: number
  bookingWindowDays: number | null
  maxPerDay: number | null
  assignmentMode: AssignmentMode
  locationType: 'google_meet' | 'video_link' | 'phone' | 'in_person' | 'custom'
  locationDetails: string
  reminderMinutes: number[]
  bookingQuestions: BookingQuestion[]
  requiresConfirmation: boolean
}

export async function findPublicTeamEventType(teamSlug: string, eventSlug: string) {
  const found = await findOrganizationBySlug(teamSlug)
  if (!found || found.organization.archivedAt) return null

  // A team behind on payment keeps its data but stops taking new bookings.
  const entitlement = await organizationEntitlement(found.organization.id)
  if (entitlement.readOnly) return null

  const [row] = await useDatabase()
    .select({
      id: eventTypes.id,
      organizationId: eventTypes.organizationId,
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
      assignmentMode: eventTypes.assignmentMode,
      locationType: eventTypes.locationType,
      locationDetails: eventTypes.locationDetails,
      reminderMinutes: eventTypes.reminderMinutes,
      bookingQuestions: eventTypes.bookingQuestions,
      requiresConfirmation: eventTypes.requiresConfirmation
    })
    .from(eventTypes)
    .where(and(
      eq(eventTypes.organizationId, found.organization.id),
      sql`lower(${eventTypes.slug}) = ${eventSlug.toLowerCase()}`,
      eq(eventTypes.hidden, false)
    ))
    .limit(1)

  if (!row) return null

  return {
    ...row,
    organizationId: found.organization.id,
    organizationName: found.organization.name,
    organizationSlug: found.organization.slug,
    renamed: found.renamed
  }
}

export type TeamEventTypeRow = NonNullable<Awaited<ReturnType<typeof findPublicTeamEventType>>>

export interface ActiveHost {
  userId: string
  memberId: string
  name: string
  email: string
  timeZone: string
  avatarUrl: string | null
  scheduleId: string | null
  scheduleTimeZone: string | null
}

/**
 * Only a current member with a usable schedule can host. Losing membership
 * cascades the host row away, so this naturally stops offering someone who
 * left without anything else having to react.
 */
export async function activeHostsFor(eventTypeId: string): Promise<ActiveHost[]> {
  const rows = await useDatabase()
    .select({
      userId: eventTypeHosts.userId,
      memberId: eventTypeHosts.memberId,
      name: users.name,
      email: users.email,
      timeZone: users.timeZone,
      avatarUrl: users.avatarUrl,
      pinnedScheduleId: eventTypeHosts.scheduleId,
      pinnedTimeZone: schedules.timeZone
    })
    .from(eventTypeHosts)
    .innerJoin(members, eq(members.id, eventTypeHosts.memberId))
    .innerJoin(users, eq(users.id, eventTypeHosts.userId))
    .leftJoin(schedules, eq(schedules.id, eventTypeHosts.scheduleId))
    .where(and(eq(eventTypeHosts.eventTypeId, eventTypeId), eq(eventTypeHosts.enabled, true)))

  if (!rows.length) return []

  // A host who pinned no schedule uses whichever is their default at booking
  // time, so reorganising their availability never drops them from rotation.
  const needDefault = rows.filter(row => !row.pinnedScheduleId).map(row => row.userId)
  const defaults = needDefault.length
    ? await useDatabase()
        .select({ id: schedules.id, userId: schedules.userId, timeZone: schedules.timeZone })
        .from(schedules)
        .where(and(inArray(schedules.userId, needDefault), eq(schedules.isDefault, true)))
    : []

  const defaultByUser = new Map(defaults.map(row => [row.userId, row]))

  return rows.map((row) => {
    const fallback = defaultByUser.get(row.userId)
    return {
      userId: row.userId,
      memberId: row.memberId,
      name: row.name,
      email: row.email,
      timeZone: row.timeZone,
      avatarUrl: row.avatarUrl,
      scheduleId: row.pinnedScheduleId ?? fallback?.id ?? null,
      scheduleTimeZone: row.pinnedTimeZone ?? fallback?.timeZone ?? null
    }
  }).filter(host => host.scheduleId)
}

async function slotsForHost(
  event: TeamEventTypeRow,
  host: ActiveHost,
  from: string,
  to: string,
  now: string
) {
  const db = useDatabase()
  const timeZone = host.scheduleTimeZone ?? host.timeZone
  const busyFrom = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString()
  const busyTo = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString()

  const [rules, overrides, taken, externalBusy] = await Promise.all([
    db.select({
      weekday: availabilityRules.weekday,
      startTime: availabilityRules.startTime,
      endTime: availabilityRules.endTime
    }).from(availabilityRules).where(eq(availabilityRules.scheduleId, host.scheduleId!)),

    db.select({
      date: dateOverrides.date,
      startTime: dateOverrides.startTime,
      endTime: dateOverrides.endTime
    }).from(dateOverrides).where(and(
      eq(dateOverrides.scheduleId, host.scheduleId!),
      gte(dateOverrides.date, from),
      lte(dateOverrides.date, to)
    )),

    // Reservations, not bookings: this is the one place that sees a host's
    // personal meetings and every team meeting they are on.
    db.select({ start: bookingHosts.startsAt, end: bookingHosts.endsAt })
      .from(bookingHosts)
      .where(and(
        eq(bookingHosts.userId, host.userId),
        isNull(bookingHosts.releasedAt),
        gte(bookingHosts.endsAt, new Date(now)),
        lte(bookingHosts.startsAt, new Date(busyTo))
      )),

    calendarBusyTimes(host.userId, busyFrom, busyTo)
  ])

  const grouped = new Map<string, DateOverride>()
  for (const row of overrides) {
    const entry = grouped.get(row.date) ?? { date: row.date, windows: [] }
    if (row.startTime && row.endTime) {
      entry.windows.push({ start: wall(row.startTime), end: wall(row.endTime) })
    }
    grouped.set(row.date, entry)
  }

  return getAvailableSlots({
    schedule: {
      timeZone,
      rules: rules.map(rule => ({
        weekday: rule.weekday as Weekday,
        start: wall(rule.startTime),
        end: wall(rule.endTime)
      })) satisfies AvailabilityRule[],
      overrides: [...grouped.values()]
    },
    eventType: {
      durationMinutes: event.durationMinutes,
      incrementMinutes: event.incrementMinutes ?? undefined,
      bufferBeforeMinutes: event.bufferBeforeMinutes,
      bufferAfterMinutes: event.bufferAfterMinutes,
      minimumNoticeMinutes: event.minimumNoticeMinutes,
      bookingWindowDays: event.bookingWindowDays ?? undefined,
      maxPerDay: event.maxPerDay ?? undefined
    },
    bookings: taken.map(row => ({ start: row.start.toISOString(), end: row.end.toISOString() })),
    externalBusy,
    from,
    to,
    now
  })
}

export async function teamSlotsFor(
  event: TeamEventTypeRow,
  hosts: ActiveHost[],
  from: string,
  to: string,
  now: string
): Promise<TeamSlot[]> {
  if (!hosts.length) return []

  const perHost = await Promise.all(hosts.map(async host => ({
    userId: host.userId,
    slots: await slotsForHost(event, host, from, to, now)
  })))

  return combineHostSlots(event.assignmentMode, perHost)
}

/** Recent load per host, used only to order candidates fairly. */
export async function hostLoads(eventTypeId: string, userIds: string[]): Promise<HostLoad[]> {
  if (!userIds.length) return []

  const since = new Date(Date.now() - 30 * 86_400_000)

  const rows = await useDatabase()
    .select({
      userId: bookingHosts.userId,
      recentCount: sql<number>`count(*)`.mapWith(Number),
      lastAssignedAt: sql<Date | null>`max(${bookingHosts.createdAt})`
    })
    .from(bookingHosts)
    .innerJoin(bookings, eq(bookings.id, bookingHosts.bookingId))
    .where(and(
      inArray(bookingHosts.userId, userIds),
      eq(bookings.eventTypeId, eventTypeId),
      gte(bookingHosts.createdAt, since)
    ))
    .groupBy(bookingHosts.userId)

  const byUser = new Map(rows.map(row => [row.userId, row]))

  return userIds.map(userId => ({
    userId,
    recentCount: byUser.get(userId)?.recentCount ?? 0,
    lastAssignedAt: byUser.get(userId)?.lastAssignedAt?.toISOString() ?? null
  }))
}

export async function chooseHosts(
  event: TeamEventTypeRow,
  slot: TeamSlot
): Promise<string[]> {
  if (event.assignmentMode === 'collective') return slot.hostIds

  const load = await hostLoads(event.id, slot.hostIds)
  const chosen = pickRoundRobinHost(slot.hostIds, load)
  return chosen ? [chosen] : []
}

export async function publicTeamProfile(teamSlug: string) {
  const found = await findOrganizationBySlug(teamSlug)
  if (!found || found.organization.archivedAt) return null

  const entitlement = await organizationEntitlement(found.organization.id)
  if (entitlement.readOnly) return null

  const items = await useDatabase()
    .select({
      slug: eventTypes.slug,
      title: eventTypes.title,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      assignmentMode: eventTypes.assignmentMode
    })
    .from(eventTypes)
    .where(and(
      eq(eventTypes.organizationId, found.organization.id),
      eq(eventTypes.hidden, false)
    ))
    .orderBy(desc(eventTypes.createdAt))

  return {
    name: found.organization.name,
    slug: found.organization.slug,
    logo: found.organization.logo,
    renamed: found.renamed,
    eventTypes: items
  }
}
