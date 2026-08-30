import { createBookingSchema } from '#shared/validation'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { bookings } from '../database/schema'
import { useDatabase } from '../database/index'
import { findPublicEventType, slotsFor } from '../services/booking-page'
import type { EventTypeRow } from '../services/booking-page'
import { findBookingByUid } from '../repositories/booking'
import { queueBookingEmails, queueBookingRequestEmails } from '../services/booking-emails'
import { cancelBookingReminders } from '../services/email-outbox'
import { cancelPendingAutomationRuns, publishBookingEvent } from '../services/workflows'
import { enforceRateLimit } from '../services/rate-limit'
import { enqueueCalendarSync } from '../services/calendar-sync'
import { CalendarUnavailableError } from '../integrations/calendar/google'
import { BookingAnswerValidationError, buildBookingAnswersSnapshot } from '../domain/booking-answers'
import { requireLocationIntegration } from '../services/event-location'
import { claimGroupSession, isGroupSessionFullError } from '../services/group-events'
import {
  createPaymentRecord,
  eventPaymentReadiness,
  movePaidBookingPayment,
  openPaidBookingCheckout,
  paymentForBooking
} from '../services/paid-booking'
import { bookingLinkTokenHash, filterInvitationSlots, requireUsableBookingLink } from '../services/booking-links'
import { claimBookingLink } from '../repositories/booking-links'
import { addUtcCalendarDays, utcCalendarDate } from '../utils/date-time'
import { personalPaidBookingFeeBps } from '../services/personal-entitlement'
import { createPersonalRecurringBooking } from '../services/recurring-booking-creation'
import { assertBookingLimits } from '../services/booking-limits'

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

  const {
    username, slug, start, durationMinutes, requestId, recurrence, name, email, guestEmails: submittedGuestEmails,
    timeZone, notes, answers, source, attribution, inviteToken, rescheduleOf
  } = parsed.data
  if (inviteToken && rescheduleOf) {
    throw createError({ statusCode: 400, statusMessage: 'Use the booking management link to move an existing meeting.' })
  }
  if (recurrence && (inviteToken || rescheduleOf)) {
    throw createError({ statusCode: 400, statusMessage: 'Recurring meetings must start from the public booking page.' })
  }
  const invitation = inviteToken ? await requireUsableBookingLink(inviteToken) : null
  const eventType = invitation ?? await findPublicEventType(username, slug)

  if (!eventType) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
  }
  if (invitation && (
    invitation.username.toLowerCase() !== username.toLowerCase()
    || invitation.slug.toLowerCase() !== slug.toLowerCase()
  )) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
  }

  const additionalGuestEmails = submittedGuestEmails ?? []
  if (additionalGuestEmails.includes(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Your email is already included as the main guest.' })
  }
  if (additionalGuestEmails.includes(eventType.hostEmail.toLowerCase())) {
    throw createError({ statusCode: 400, statusMessage: 'The host is already part of this meeting.' })
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

  if (recurrence && requestId) {
    if (invitation) {
      throw createError({ statusCode: 400, statusMessage: 'Recurring meetings must start from the public booking page.' })
    }
    let recurring
    try {
      await requireLocationIntegration(eventType.hostId, eventType.locationType)
      recurring = await createPersonalRecurringBooking({
        eventType: eventType as EventTypeRow,
        requestId,
        start,
        durationMinutes: durationMinutes ?? eventType.durationMinutes,
        recurrence,
        guest: {
          name,
          email,
          additionalGuestEmails,
          timeZone,
          answers: answerSnapshot ?? undefined,
          source,
          attribution
        }
      })
    } catch (error) {
      if (error instanceof CalendarUnavailableError || (
        ['google_meet', 'microsoft_teams', 'zoom'].includes(eventType.locationType)
        && (error as { statusCode?: number }).statusCode === 409
      )) {
        throw createError({
          statusCode: 503,
          statusMessage: 'Recurring times are temporarily unavailable. Please try again shortly.'
        })
      }
      throw error
    }
    return {
      ...recurring,
      locationType: eventType.locationType,
      locationDetails: eventType.locationDetails,
      meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null
    }
  }

  const now = new Date().toISOString()
  const wanted = new Date(start).getTime()

  // A day either side, because the slot's date in the host's timezone can
  // differ from its UTC date.
  const wantedDate = utcCalendarDate(wanted)
  const day = (offset: number) => addUtcCalendarDays(wantedDate, offset)

  // Re-derive the slot rather than trusting the posted time: without this, a
  // crafted request could book outside the host's hours entirely. Compare
  // instants, not strings — the engine emits no milliseconds, Date does.
  let offered
  try {
    await requireLocationIntegration(eventType.hostId, eventType.locationType)
    const available = await slotsFor(eventType, day(-1), day(1), now, durationMinutes)
    offered = invitation ? filterInvitationSlots(invitation, available) : available
  } catch (error) {
    if (error instanceof CalendarUnavailableError || (
      ['google_meet', 'microsoft_teams', 'zoom'].includes(eventType.locationType)
      && (error as { statusCode?: number }).statusCode === 409
    )) {
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

    if (previous.attendeeEmail.toLowerCase() !== email.toLowerCase()) {
      throw createError({ statusCode: 409, statusMessage: 'Use the email address already attached to this booking.' })
    }
  }

  const payment = await eventPaymentReadiness(eventType.id)
  const previousPayment = previous ? await paymentForBooking(previous.id) : null
  if (previousPayment && previousPayment.status !== 'paid') {
    throw createError({ statusCode: 409, statusMessage: 'Finish or cancel the existing payment before moving this booking.' })
  }
  const paymentCovered = previousPayment?.status === 'paid'
  const awaitingPayment = Boolean(payment && !paymentCovered)
  const platformFeeBps = awaitingPayment
    ? await personalPaidBookingFeeBps(eventType.hostId)
    : undefined

  const uid = crypto.randomUUID()

  try {
    // One transaction: cancelling the old slot and taking the new one must
    // either both happen or neither, or a guest can lose their time and get
    // nothing back.
    await useDatabase().transaction(async (tx) => {
      if (eventType.maxPerDay || eventType.maxPerWeek || eventType.maxPerMonth) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventType.id}, 0))`)
      }
      if (inviteToken) {
        const claimed = await claimBookingLink(bookingLinkTokenHash(inviteToken), eventType.id, tx)
        if (!claimed) {
          throw createError({ statusCode: 409, statusMessage: 'This invitation was just used or is no longer available.' })
        }
      }
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
        await cancelPendingAutomationRuns(previous.id, tx)
      }

      const groupSession = eventType.capacity > 1
        ? await claimGroupSession({
            eventTypeId: eventType.id,
            startsAt: new Date(slot.start),
            endsAt: new Date(slot.end),
            capacity: eventType.capacity,
            partySize: 1 + additionalGuestEmails.length
          }, tx)
        : null

      await assertBookingLimits({
        executor: tx,
        eventTypeId: eventType.id,
        hosts: [{
          userId: eventType.hostId,
          timeZone: eventType.scheduleTimeZone ?? eventType.hostTimeZone
        }],
        occurrences: [{ startsAt: slot.start, groupSessionId: groupSession?.id }],
        limits: {
          maxPerDay: eventType.maxPerDay,
          maxPerWeek: eventType.maxPerWeek,
          maxPerMonth: eventType.maxPerMonth
        }
      })

      const [created] = await tx.insert(bookings).values({
        eventTypeId: eventType.id,
        seriesId: previous?.seriesId ?? null,
        seriesPosition: previous?.seriesPosition ?? null,
        groupSessionId: groupSession?.id ?? null,
        hostId: eventType.hostId,
        uid,
        startsAt: new Date(slot.start),
        endsAt: new Date(slot.end),
        attendeeName: name,
        attendeeEmail: email,
        attendeeTimeZone: timeZone,
        additionalGuestEmails,
        status: awaitingPayment ? 'awaiting_payment' : eventType.requiresConfirmation ? 'pending' : 'confirmed',
        locationType: eventType.locationType,
        locationDetails: eventType.locationDetails,
        meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null,
        answers: answerSnapshot,
        source,
        attribution,
        rescheduledFromId: previous?.id ?? null
      }).returning({ id: bookings.id })

      if (!created) throw new Error('Booking insert did not return a record.')
      if (awaitingPayment && payment) {
        await createPaymentRecord({
          bookingId: created.id,
          recipientId: payment.recipient.id,
          amountCents: payment.amountCents,
          currency: payment.currency,
          reference: `booking-${uid}`,
          platformFeeBps
        }, tx)
      } else {
        if (paymentCovered && previous) {
          const moved = await movePaidBookingPayment(previous.id, created.id, tx)
          if (!moved) throw new Error('The existing booking payment could not be moved.')
        }
        if (!eventType.requiresConfirmation) await enqueueCalendarSync(created.id, 'upsert', tx)
        await publishBookingEvent({
          type: previous ? 'booking_rescheduled' : eventType.requiresConfirmation ? 'booking_requested' : 'booking_created',
          userId: eventType.hostId,
          bookingId: created.id,
          eventTypeId: eventType.id,
          payload: previous ? { previousBookingId: previous.id, paid: paymentCovered } : undefined
        }, tx)
      }

      const notice = {
        uid,
        eventTitle: eventType.title,
        hostName: eventType.hostName,
        hostEmail: eventType.hostEmail,
        hostUsername: eventType.username,
        hostTimeZone: eventType.scheduleTimeZone ?? eventType.hostTimeZone,
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
        notes: answerSnapshot?.notes ?? null
      }
      if (!awaitingPayment) {
        if (eventType.requiresConfirmation) await queueBookingRequestEmails(notice, tx)
        else await queueBookingEmails(notice, tx)
      }
    })
  } catch (error) {
    // Postgres rejected an overlap, which means someone else won the race.
    if ((error as { code?: string }).code === SLOT_TAKEN) {
      throw createError({ statusCode: 409, statusMessage: 'Someone just booked that time.' })
    }
    if (isGroupSessionFullError(error)) {
      throw createError({ statusCode: 409, statusMessage: 'That group session has just filled up.' })
    }
    throw error
  }

  const checkout = awaitingPayment ? await openPaidBookingCheckout(uid) : null
  return {
    uid,
    start: slot.start,
    end: slot.end,
    moved: Boolean(previous),
    status: awaitingPayment ? 'awaiting_payment' : eventType.requiresConfirmation ? 'pending' : 'confirmed',
    checkoutUrl: checkout?.checkoutUrl ?? null,
    paymentExpiresAt: checkout?.expiresAt ?? null,
    locationType: eventType.locationType,
    locationDetails: eventType.locationDetails,
    meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null
  }
})
