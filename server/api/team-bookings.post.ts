import { z } from 'zod'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { bookingAttributionSchema, bookingSourceSchema, emailSchema, timeZoneSchema } from '#shared/validation'
import { bookingHosts, bookings } from '../database/schema'
import { useDatabase } from '../database/index'
import {
  activeHostsFor,
  chooseHosts,
  findPublicTeamEventType,
  teamSlotsFor
} from '../services/team-booking'
import { queueBookingEmails, queueBookingRequestEmails } from '../services/booking-emails'
import { enforceRateLimit } from '../services/rate-limit'
import { enqueueCalendarSync } from '../services/calendar-sync'
import { CalendarUnavailableError } from '../integrations/calendar/google'
import { BookingAnswerValidationError, buildBookingAnswersSnapshot } from '../domain/booking-answers'
import { findBookingByUid } from '../repositories/booking'
import { cancelBookingReminders } from '../services/email-outbox'
import { requireTeamLocationIntegrations } from '../services/event-location'

const SLOT_TAKEN = '23P01'

const bodySchema = z.object({
  team: z.string().min(1),
  slug: z.string().min(1),
  start: z.iso.datetime(),
  name: z.string().trim().min(1, 'Please give a name').max(80),
  email: emailSchema,
  guestEmails: z.array(emailSchema).max(10).transform(values => [...new Set(values)]).optional(),
  timeZone: timeZoneSchema,
  notes: z.string().trim().max(2000).optional(),
  answers: z.record(z.string().trim().min(1).max(64), z.string().trim().max(2000)).optional(),
  source: bookingSourceSchema.default('hosted'),
  attribution: bookingAttributionSchema,
  rescheduleOf: z.string().trim().max(64).optional()
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'create-team-booking', limit: 12, windowSeconds: 600 })
  const parsed = await readValidatedBody(event, bodySchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those booking details are not valid.'
    })
  }

  const { team, slug, start, name, email, guestEmails, timeZone, notes, answers, source, attribution, rescheduleOf } = parsed.data
  const eventType = await findPublicTeamEventType(team, slug)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })

  const previous = rescheduleOf ? await findBookingByUid(rescheduleOf) : null
  if (rescheduleOf && !previous) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking to move' })
  }
  if (previous) {
    if (previous.organizationId !== eventType.organizationId || previous.eventTypeId !== eventType.id) {
      throw createError({ statusCode: 409, statusMessage: 'That booking cannot be moved to this event.' })
    }
    if (!['pending', 'confirmed'].includes(previous.status) || previous.endsAt <= new Date()) {
      throw createError({ statusCode: 409, statusMessage: 'That booking can no longer be moved.' })
    }
    // A management link can move its booking, but it cannot silently transfer
    // the reservation and future notifications to a different email address.
    if (previous.attendeeEmail.toLowerCase() !== email.toLowerCase()) {
      throw createError({ statusCode: 409, statusMessage: 'Use the email address already attached to this booking.' })
    }
  }

  const hosts = await activeHostsFor(eventType.id)
  if (!hosts.length) {
    throw createError({ statusCode: 409, statusMessage: 'This team event has no available hosts right now.' })
  }

  const additionalGuestEmails = guestEmails ?? []
  if (additionalGuestEmails.includes(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Your email is already included as the main guest.' })
  }

  let answerSnapshot
  try {
    answerSnapshot = buildBookingAnswersSnapshot(eventType.bookingQuestions, answers, notes)
  } catch (error) {
    if (error instanceof BookingAnswerValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }

  const now = new Date().toISOString()
  const wanted = new Date(start).getTime()
  const day = (offset: number) => new Date(wanted + offset * 86_400_000).toISOString().slice(0, 10)

  // Re-derive the slot rather than trusting the posted time, and re-derive it
  // now rather than reusing what the page was shown: a host can have become
  // busy between the calendar loading and this submission.
  let offered
  try {
    offered = await teamSlotsFor(eventType, hosts, day(-1), day(1), now)
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Booking times are temporarily unavailable. Please try again shortly.'
      })
    }
    throw error
  }

  const slot = offered.find(candidate => new Date(candidate.start).getTime() === wanted)
  if (!slot) {
    throw createError({ statusCode: 409, statusMessage: 'That time is no longer available.' })
  }

  let attending: typeof hosts = []
  const uid = crypto.randomUUID()

  try {
    await useDatabase().transaction(async (tx) => {
      // Serialize assignment decisions for this event type. Without this lock,
      // two simultaneous round-robin requests can both observe the same load
      // and select the same host even when another eligible host is free.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventType.id}, 0))`)

      if (previous) {
        const [moved] = await tx.update(bookings)
          .set({
            status: 'cancelled',
            cancellationReason: 'Moved to another time',
            updatedAt: sql`now()`
          })
          .where(and(
            eq(bookings.id, previous.id),
            inArray(bookings.status, ['pending', 'confirmed']),
            gt(bookings.endsAt, new Date())
          ))
          .returning({ id: bookings.id })

        if (!moved) {
          throw createError({ statusCode: 409, statusMessage: 'That booking was already moved or cancelled.' })
        }
        await enqueueCalendarSync(previous.id, 'delete', tx)
        await cancelBookingReminders(previous.uid, tx)
      }

      const assigned = await chooseHosts(eventType, slot, tx)
      if (!assigned.length) {
        throw createError({ statusCode: 409, statusMessage: 'That time is no longer available.' })
      }

      // Connections can be revoked after an event type is configured. Verify
      // the hosts selected for this booking before persisting a meeting that
      // could never receive its Google Meet link.
      try {
        await requireTeamLocationIntegrations(
          eventType.locationType === 'zoom' ? assigned.slice(0, 1) : assigned,
          eventType.locationType
        )
      } catch (error) {
        if (['google_meet', 'microsoft_teams', 'zoom'].includes(eventType.locationType)) {
          throw createError({
            statusCode: 503,
            statusMessage: 'Booking times are temporarily unavailable. Please try again shortly.',
            cause: error
          })
        }
        throw error
      }

      const organizer = hosts.find(host => host.userId === assigned[0])
      if (!organizer) {
        throw createError({ statusCode: 409, statusMessage: 'That host is no longer available.' })
      }
      attending = hosts.filter(host => assigned.includes(host.userId))

      const [created] = await tx.insert(bookings).values({
        organizationId: eventType.organizationId,
        eventTypeId: eventType.id,
        // The organizer owns the calendar event and the meeting link. A trigger
        // reserves their time; the co-hosts are added just below.
        hostId: organizer.userId,
        uid,
        startsAt: new Date(slot.start),
        endsAt: new Date(slot.end),
        attendeeName: name,
        attendeeEmail: email,
        attendeeTimeZone: timeZone,
        additionalGuestEmails,
        status: eventType.requiresConfirmation ? 'pending' : 'confirmed',
        locationType: eventType.locationType,
        locationDetails: eventType.locationDetails,
        meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null,
        answers: answerSnapshot,
        source,
        attribution,
        rescheduledFromId: previous?.id ?? null
      }).returning({ id: bookings.id })

      if (!created) throw new Error('Booking insert did not return a record.')

      const coHosts = assigned.filter(userId => userId !== organizer.userId)
      if (coHosts.length) {
        // The exclusion constraint fires here if any co-host was taken in the
        // moment between the availability check and this write.
        await tx.insert(bookingHosts).values(coHosts.map(userId => ({
          bookingId: created.id,
          userId,
          isOrganizer: false,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end)
        })))
      }

      if (!eventType.requiresConfirmation) await enqueueCalendarSync(created.id, 'upsert', tx)

      const notice = {
        uid,
        eventTitle: eventType.title,
        hostName: attending.length > 1
          ? `${eventType.organizationName} (${attending.map(host => host.name).join(', ')})`
          : organizer.name,
        hostEmail: organizer.email,
        hostUsername: eventType.organizationSlug,
        hostTimeZone: organizer.scheduleTimeZone ?? organizer.timeZone,
        attendeeName: name,
        attendeeEmail: email,
        additionalGuestEmails,
        attendeeTimeZone: timeZone,
        startsAt: slot.start,
        endsAt: slot.end,
        locationType: eventType.locationType,
        locationDetails: eventType.locationDetails,
        meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null,
        reminderMinutes: eventType.reminderMinutes,
        answers: answerSnapshot?.responses ?? [],
        notes: answerSnapshot?.notes ?? null,
        hostRecipients: attending.map(host => ({
          name: host.name,
          email: host.email,
          timeZone: host.scheduleTimeZone ?? host.timeZone,
          isOrganizer: host.userId === organizer.userId
        })),
        publicBookingPath: `/team/${encodeURIComponent(eventType.organizationSlug)}/${encodeURIComponent(eventType.slug)}`
      }

      if (eventType.requiresConfirmation) await queueBookingRequestEmails(notice, tx)
      else await queueBookingEmails(notice, tx)
    })
  } catch (error) {
    if ((error as { code?: string }).code === SLOT_TAKEN) {
      throw createError({ statusCode: 409, statusMessage: 'Someone just booked that time.' })
    }
    throw error
  }

  return {
    uid,
    start: slot.start,
    end: slot.end,
    status: eventType.requiresConfirmation ? 'pending' : 'confirmed',
    moved: Boolean(previous),
    hostNames: attending.map(host => host.name),
    locationType: eventType.locationType,
    locationDetails: eventType.locationDetails,
    meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null
  }
})
