import { createBookingSchema } from '#shared/validation'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { bookings } from '../database/schema'
import { useDatabase } from '../utils/database'
import { findPublicEventType, slotsFor } from '../utils/booking-page'
import { findBookingByUid } from '../utils/booking-manage'
import { queueBookingEmails } from '../utils/booking-emails'
import { cancelBookingReminders } from '../utils/email-outbox'
import { enforceRateLimit } from '../utils/rate-limit'
import { enqueueCalendarSync } from '../utils/calendar-sync'
import { CalendarUnavailableError } from '../utils/google-calendar'

const SLOT_TAKEN = '23P01'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'create-booking', limit: 12, windowSeconds: 600 })
  const parsed = await readValidatedBody(event, createBookingSchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those booking details are not valid.'
    })
  }

  const { username, slug, start, name, email, timeZone, notes, rescheduleOf } = parsed.data
  const eventType = await findPublicEventType(username, slug)

  if (!eventType) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
  }

  const now = new Date().toISOString()
  const wanted = new Date(start).getTime()

  // A day either side, because the slot's date in the host's timezone can
  // differ from its UTC date.
  const day = (offset: number) =>
    new Date(wanted + offset * 86_400_000).toISOString().slice(0, 10)

  // Re-derive the slot rather than trusting the posted time: without this, a
  // crafted request could book outside the host's hours entirely. Compare
  // instants, not strings — the engine emits no milliseconds, Date does.
  let offered
  try {
    offered = await slotsFor(eventType, day(-1), day(1), now)
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

  const previous = rescheduleOf ? await findBookingByUid(rescheduleOf) : null

  if (rescheduleOf && !previous) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking to move' })
  }

  if (previous) {
    if (previous.hostId !== eventType.hostId || previous.eventTypeId !== eventType.id) {
      throw createError({ statusCode: 409, statusMessage: 'That booking cannot be moved to this event.' })
    }

    if (!['pending', 'confirmed'].includes(previous.status) || previous.endsAt <= new Date()) {
      throw createError({ statusCode: 409, statusMessage: 'That booking can no longer be moved.' })
    }
  }

  const uid = crypto.randomUUID()

  try {
    // One transaction: cancelling the old slot and taking the new one must
    // either both happen or neither, or a guest can lose their time and get
    // nothing back.
    await useDatabase().transaction(async (tx) => {
      if (previous && previous.status !== 'cancelled') {
        const [moved] = await tx
          .update(bookings)
          .set({ status: 'cancelled', cancellationReason: 'Moved to another time', updatedAt: sql`now()` })
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

      const [created] = await tx.insert(bookings).values({
        eventTypeId: eventType.id,
        hostId: eventType.hostId,
        uid,
        startsAt: new Date(slot.start),
        endsAt: new Date(slot.end),
        attendeeName: name,
        attendeeEmail: email,
        attendeeTimeZone: timeZone,
        locationType: eventType.locationType,
        locationDetails: eventType.locationDetails,
        meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null,
        answers: notes ? { notes } : null,
        rescheduledFromId: previous?.id ?? null
      }).returning({ id: bookings.id })

      if (!created) throw new Error('Booking insert did not return a record.')
      await enqueueCalendarSync(created.id, 'upsert', tx)

      await queueBookingEmails({
        uid,
        eventTitle: eventType.title,
        hostName: eventType.hostName,
        hostEmail: eventType.hostEmail,
        hostTimeZone: eventType.scheduleTimeZone ?? eventType.hostTimeZone,
        attendeeName: name,
        attendeeEmail: email,
        attendeeTimeZone: timeZone,
        startsAt: slot.start,
        endsAt: slot.end,
        locationType: eventType.locationType,
        locationDetails: eventType.locationDetails,
        meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null,
        reminderMinutes: eventType.reminderMinutes
      }, tx)
    })
  } catch (error) {
    // Postgres rejected an overlap, which means someone else won the race.
    if ((error as { code?: string }).code === SLOT_TAKEN) {
      throw createError({ statusCode: 409, statusMessage: 'Someone just booked that time.' })
    }
    throw error
  }

  return {
    uid,
    start: slot.start,
    end: slot.end,
    moved: Boolean(previous),
    locationType: eventType.locationType,
    locationDetails: eventType.locationDetails,
    meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null
  }
})
