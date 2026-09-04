import { asc, eq, sql } from 'drizzle-orm'
import type { BookingAnswersSnapshot, BookingAttribution, BookingSource } from '#shared/validation'
import type { RecurringBookingRequest } from '#shared/recurrence'
import { bookingHosts, bookings, bookingSeries } from '../database/schema'
import { useDatabase } from '../database'
import type { EventTypeRow } from './booking-page'
import type { ActiveHost, TeamEventTypeRow } from './team-booking'
import { chooseHosts } from './team-booking'
import { personalRecurringAvailability, recurringRequestFingerprint, teamRecurringAvailability } from './recurring-booking'
import { enqueueCalendarSync } from './calendar-sync'
import { publishBookingEvent } from './workflows'
import { queueBookingEmails } from './booking-emails'
import { requireTeamLocationIntegrations } from './event-location'
import { assertBookingLimits } from './booking-limits'

const SLOT_TAKEN = '23P01'

interface GuestInput {
  name: string
  email: string
  additionalGuestEmails: string[]
  timeZone: string
  answers: BookingAnswersSnapshot | undefined
  source: BookingSource
  attribution: BookingAttribution | undefined
}

function fingerprintInput(input: {
  eventTypeId: string
  requestId: string
  start: string
  durationMinutes: number
  recurrence: RecurringBookingRequest
  guest: GuestInput
}) {
  return recurringRequestFingerprint({
    eventTypeId: input.eventTypeId,
    start: input.start,
    durationMinutes: input.durationMinutes,
    recurrence: input.recurrence,
    attendeeName: input.guest.name,
    attendeeEmail: input.guest.email,
    additionalGuestEmails: input.guest.additionalGuestEmails,
    timeZone: input.guest.timeZone,
    answers: input.guest.answers ?? null,
    source: input.guest.source,
    attribution: input.guest.attribution ?? null
  })
}

async function existingSeriesResult(requestId: string, fingerprint: string) {
  const [series] = await useDatabase().select({
    id: bookingSeries.id,
    fingerprint: bookingSeries.requestFingerprint,
    occurrenceCount: bookingSeries.occurrenceCount
  }).from(bookingSeries).where(eq(bookingSeries.requestId, requestId)).limit(1)
  if (!series) return null
  if (series.fingerprint !== fingerprint) {
    throw createError({ statusCode: 409, statusMessage: 'That recurring request identifier was already used with different details.' })
  }
  const items = await useDatabase().select({
    uid: bookings.uid,
    start: bookings.startsAt,
    end: bookings.endsAt
  }).from(bookings).where(eq(bookings.seriesId, series.id)).orderBy(asc(bookings.seriesPosition))
  const first = items[0]
  if (!first || items.length !== series.occurrenceCount) {
    throw new Error('A recurring booking series is incomplete.')
  }
  return {
    uid: first.uid,
    start: first.start.toISOString(),
    end: first.end.toISOString(),
    status: 'confirmed' as const,
    seriesCount: items.length,
    occurrences: items.map(item => ({ uid: item.uid, start: item.start.toISOString(), end: item.end.toISOString() }))
  }
}

function unavailableOccurrence(items: Array<{ position: number, available: boolean }>) {
  return items.find(item => !item.available)?.position ?? null
}

function seriesConflict(error: unknown) {
  return (error as { code?: string }).code === SLOT_TAKEN
}

export async function createPersonalRecurringBooking(input: {
  eventType: EventTypeRow
  requestId: string
  start: string
  durationMinutes: number
  recurrence: RecurringBookingRequest
  guest: GuestInput
}) {
  const fingerprint = fingerprintInput({ eventTypeId: input.eventType.id, ...input })
  const existing = await existingSeriesResult(input.requestId, fingerprint)
  if (existing) return existing

  const preview = await personalRecurringAvailability({
    eventType: input.eventType,
    firstStart: input.start,
    timeZone: input.guest.timeZone,
    durationMinutes: input.durationMinutes,
    recurrence: input.recurrence
  })
  const unavailable = unavailableOccurrence(preview)
  if (unavailable) {
    throw createError({ statusCode: 409, statusMessage: `Meeting ${unavailable} is no longer available. No meetings were created.` })
  }

  try {
    const result = await useDatabase().transaction(async (tx) => {
      if (input.eventType.maxPerDay || input.eventType.maxPerWeek || input.eventType.maxPerMonth) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.eventType.id}, 0))`)
      }
      await assertBookingLimits({
        executor: tx,
        eventTypeId: input.eventType.id,
        hosts: [{
          userId: input.eventType.hostId,
          timeZone: input.eventType.scheduleTimeZone ?? input.eventType.hostTimeZone
        }],
        occurrences: preview.map(occurrence => ({ startsAt: occurrence.startsAt })),
        limits: {
          maxPerDay: input.eventType.maxPerDay,
          maxPerWeek: input.eventType.maxPerWeek,
          maxPerMonth: input.eventType.maxPerMonth
        }
      })
      const [series] = await tx.insert(bookingSeries).values({
        requestId: input.requestId,
        requestFingerprint: fingerprint,
        eventTypeId: input.eventType.id,
        frequency: input.recurrence.frequency,
        occurrenceCount: input.recurrence.occurrences,
        timeZone: input.guest.timeZone,
        durationMinutes: input.durationMinutes
      }).returning({ id: bookingSeries.id })
      if (!series) throw new Error('Recurring booking series insert returned no record.')

      const created: Array<{ id: string, uid: string, start: string, end: string }> = []
      for (const occurrence of preview) {
        const uid = crypto.randomUUID()
        const [booking] = await tx.insert(bookings).values({
          seriesId: series.id,
          seriesPosition: occurrence.position,
          eventTypeId: input.eventType.id,
          hostId: input.eventType.hostId,
          uid,
          startsAt: new Date(occurrence.startsAt),
          endsAt: new Date(occurrence.endsAt),
          attendeeName: input.guest.name,
          attendeeEmail: input.guest.email,
          attendeeTimeZone: input.guest.timeZone,
          additionalGuestEmails: input.guest.additionalGuestEmails,
          status: 'confirmed',
          locationType: input.eventType.locationType,
          locationDetails: input.eventType.locationDetails,
          meetingUrl: input.eventType.locationType === 'video_link' ? input.eventType.locationDetails : null,
          answers: input.guest.answers,
          source: input.guest.source,
          attribution: input.guest.attribution
        }).returning({ id: bookings.id })
        if (!booking) throw new Error('Recurring booking insert returned no record.')
        await enqueueCalendarSync(booking.id, 'upsert', tx)
        await publishBookingEvent({
          type: 'booking_created',
          userId: input.eventType.hostId,
          bookingId: booking.id,
          eventTypeId: input.eventType.id,
          payload: { seriesId: series.id, seriesPosition: occurrence.position }
        }, tx)
        await queueBookingEmails({
          uid,
          eventTitle: input.eventType.title,
          hostName: input.eventType.hostName,
          hostUserId: input.eventType.hostId,
          hostEmail: input.eventType.hostEmail,
          hostUsername: input.eventType.username,
          hostTimeZone: input.eventType.scheduleTimeZone ?? input.eventType.hostTimeZone,
          attendeeName: input.guest.name,
          attendeeEmail: input.guest.email,
          additionalGuestEmails: input.guest.additionalGuestEmails,
          attendeeTimeZone: input.guest.timeZone,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          locationType: input.eventType.locationType,
          locationDetails: input.eventType.locationDetails,
          meetingUrl: input.eventType.locationType === 'video_link' ? input.eventType.locationDetails : null,
          reminderMinutes: input.eventType.reminderMinutes,
          answers: input.guest.answers?.responses ?? [],
          notes: input.guest.answers?.notes ?? null,
          series: occurrence.position === 1
            ? {
                frequency: input.recurrence.frequency,
                occurrenceCount: preview.length,
                occurrences: preview.map(item => ({ startsAt: item.startsAt, endsAt: item.endsAt }))
              }
            : undefined
        }, tx, { sendConfirmation: occurrence.position === 1 })
        created.push({ id: booking.id, uid, start: occurrence.startsAt, end: occurrence.endsAt })
      }
      return created
    })
    const first = result[0]!
    return {
      uid: first.uid,
      start: first.start,
      end: first.end,
      status: 'confirmed' as const,
      seriesCount: result.length,
      occurrences: result.map(item => ({ uid: item.uid, start: item.start, end: item.end }))
    }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      const duplicate = await existingSeriesResult(input.requestId, fingerprint)
      if (duplicate) return duplicate
    }
    if (seriesConflict(error)) {
      throw createError({ statusCode: 409, statusMessage: 'One of those recurring times was just booked. No meetings were created.' })
    }
    throw error
  }
}

export async function createTeamRecurringBooking(input: {
  eventType: TeamEventTypeRow
  hosts: ActiveHost[]
  requestId: string
  start: string
  durationMinutes: number
  recurrence: RecurringBookingRequest
  guest: GuestInput
}) {
  const fingerprint = fingerprintInput({ eventTypeId: input.eventType.id, ...input })
  const existing = await existingSeriesResult(input.requestId, fingerprint)
  if (existing) return existing

  const preview = await teamRecurringAvailability({
    eventType: input.eventType,
    hosts: input.hosts,
    firstStart: input.start,
    timeZone: input.guest.timeZone,
    durationMinutes: input.durationMinutes,
    recurrence: input.recurrence
  })
  const unavailable = unavailableOccurrence(preview.occurrences)
  if (unavailable || !preview.commonHostIds.length) {
    throw createError({ statusCode: 409, statusMessage: `Meeting ${unavailable ?? 1} is no longer available. No meetings were created.` })
  }
  await requireTeamLocationIntegrations(preview.commonHostIds, input.eventType.locationType)

  try {
    const result = await useDatabase().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.eventType.id}, 0))`)
      const firstOccurrence = preview.occurrences[0]!
      const assigned = await chooseHosts(input.eventType, {
        start: firstOccurrence.startsAt,
        end: firstOccurrence.endsAt,
        hostIds: preview.commonHostIds
      }, tx)
      if (!assigned.length) throw createError({ statusCode: 409, statusMessage: 'No host is available for every meeting in that series.' })
      const organizer = input.hosts.find(host => host.userId === assigned[0])
      if (!organizer) throw createError({ statusCode: 409, statusMessage: 'That host is no longer available.' })
      const attending = input.hosts.filter(host => assigned.includes(host.userId))

      await assertBookingLimits({
        executor: tx,
        eventTypeId: input.eventType.id,
        hosts: attending.map(host => ({
          userId: host.userId,
          timeZone: host.scheduleTimeZone ?? host.timeZone
        })),
        occurrences: preview.occurrences.map(occurrence => ({ startsAt: occurrence.startsAt })),
        limits: {
          maxPerDay: input.eventType.maxPerDay,
          maxPerWeek: input.eventType.maxPerWeek,
          maxPerMonth: input.eventType.maxPerMonth
        }
      })

      const [series] = await tx.insert(bookingSeries).values({
        requestId: input.requestId,
        requestFingerprint: fingerprint,
        eventTypeId: input.eventType.id,
        organizationId: input.eventType.organizationId,
        frequency: input.recurrence.frequency,
        occurrenceCount: input.recurrence.occurrences,
        timeZone: input.guest.timeZone,
        durationMinutes: input.durationMinutes
      }).returning({ id: bookingSeries.id })
      if (!series) throw new Error('Recurring booking series insert returned no record.')

      const created: Array<{ uid: string, start: string, end: string }> = []
      for (const occurrence of preview.occurrences) {
        const uid = crypto.randomUUID()
        const [booking] = await tx.insert(bookings).values({
          organizationId: input.eventType.organizationId,
          seriesId: series.id,
          seriesPosition: occurrence.position,
          eventTypeId: input.eventType.id,
          hostId: organizer.userId,
          uid,
          startsAt: new Date(occurrence.startsAt),
          endsAt: new Date(occurrence.endsAt),
          attendeeName: input.guest.name,
          attendeeEmail: input.guest.email,
          attendeeTimeZone: input.guest.timeZone,
          additionalGuestEmails: input.guest.additionalGuestEmails,
          status: 'confirmed',
          locationType: input.eventType.locationType,
          locationDetails: input.eventType.locationDetails,
          meetingUrl: input.eventType.locationType === 'video_link' ? input.eventType.locationDetails : null,
          answers: input.guest.answers,
          source: input.guest.source,
          attribution: input.guest.attribution
        }).returning({ id: bookings.id })
        if (!booking) throw new Error('Recurring booking insert returned no record.')
        const coHosts = assigned.filter(userId => userId !== organizer.userId)
        if (coHosts.length) {
          await tx.insert(bookingHosts).values(coHosts.map(userId => ({
            bookingId: booking.id,
            userId,
            isOrganizer: false,
            startsAt: new Date(occurrence.startsAt),
            endsAt: new Date(occurrence.endsAt)
          })))
        }
        await enqueueCalendarSync(booking.id, 'upsert', tx)
        await publishBookingEvent({
          type: 'booking_created',
          organizationId: input.eventType.organizationId,
          bookingId: booking.id,
          eventTypeId: input.eventType.id,
          payload: { seriesId: series.id, seriesPosition: occurrence.position }
        }, tx)
        await queueBookingEmails({
          uid,
          organizationId: input.eventType.organizationId,
          eventTitle: input.eventType.title,
          hostName: attending.length > 1
            ? `${input.eventType.organizationName} (${attending.map(host => host.name).join(', ')})`
            : organizer.name,
          hostUserId: organizer.userId,
          hostEmail: organizer.email,
          hostUsername: input.eventType.organizationSlug,
          hostTimeZone: organizer.scheduleTimeZone ?? organizer.timeZone,
          attendeeName: input.guest.name,
          attendeeEmail: input.guest.email,
          additionalGuestEmails: input.guest.additionalGuestEmails,
          attendeeTimeZone: input.guest.timeZone,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          locationType: input.eventType.locationType,
          locationDetails: input.eventType.locationDetails,
          meetingUrl: input.eventType.locationType === 'video_link' ? input.eventType.locationDetails : null,
          reminderMinutes: input.eventType.reminderMinutes,
          answers: input.guest.answers?.responses ?? [],
          notes: input.guest.answers?.notes ?? null,
          hostRecipients: attending.map(host => ({
            userId: host.userId,
            name: host.name,
            email: host.email,
            timeZone: host.scheduleTimeZone ?? host.timeZone,
            isOrganizer: host.userId === organizer.userId
          })),
          publicBookingPath: `/team/${encodeURIComponent(input.eventType.organizationSlug)}/${encodeURIComponent(input.eventType.slug)}`,
          series: occurrence.position === 1
            ? {
                frequency: input.recurrence.frequency,
                occurrenceCount: preview.occurrences.length,
                occurrences: preview.occurrences.map(item => ({ startsAt: item.startsAt, endsAt: item.endsAt }))
              }
            : undefined
        }, tx, { sendConfirmation: occurrence.position === 1 })
        created.push({ uid, start: occurrence.startsAt, end: occurrence.endsAt })
      }
      return created
    })
    const first = result[0]!
    return {
      uid: first.uid,
      start: first.start,
      end: first.end,
      status: 'confirmed' as const,
      seriesCount: result.length,
      occurrences: result
    }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      const duplicate = await existingSeriesResult(input.requestId, fingerprint)
      if (duplicate) return duplicate
    }
    if (seriesConflict(error)) {
      throw createError({ statusCode: 409, statusMessage: 'One of those recurring times was just booked. No meetings were created.' })
    }
    throw error
  }
}
