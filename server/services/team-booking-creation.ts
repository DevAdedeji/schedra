import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import type { CreateTeamBookingInput, MeetingLocationType } from '#shared/validation'
import { bookingHosts, bookings } from '../database/schema'
import { useDatabase } from '../database/index'
import {
  activeHostsFor,
  chooseHosts,
  findPublicTeamEventType,
  teamSlotsFor
} from './team-booking'
import { queueBookingEmails, queueBookingRequestEmails, queueBookingRescheduledEmails } from './booking-emails'
import { enqueueCalendarSync } from './calendar-sync'
import { CalendarUnavailableError } from '../integrations/calendar/google'
import { BookingAnswerValidationError, buildBookingAnswersSnapshot } from '../domain/booking-answers'
import { assignedHostsForBooking, findBookingByUid } from '../repositories/booking'
import { cancelBookingReminders } from './email-outbox'
import { cancelPendingAutomationRuns, publishBookingEvent } from './workflows'
import { requireTeamLocationIntegrations } from './event-location'
import {
  assignedHostsForGroupSessions,
  claimGroupSession,
  isGroupSessionFullError
} from './group-events'
import {
  createPaymentRecord,
  eventPaymentReadiness,
  movePaidBookingPayment,
  openPaidBookingCheckout,
  paymentForBooking
} from './paid-booking'
import { addUtcCalendarDays, utcCalendarDate } from '../utils/date-time'
import { createTeamRecurringBooking } from './recurring-booking-creation'
import { assertBookingLimits } from './booking-limits'

const SLOT_TAKEN = '23P01'

export interface TeamBookingCreationResult {
  uid: string
  start: string
  end: string
  status: 'awaiting_payment' | 'pending' | 'confirmed'
  hostNames: string[]
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl: string | null
  moved?: boolean
  checkoutUrl?: string | null
  paymentExpiresAt?: string | null
  seriesCount?: number
  occurrences?: Array<{ uid: string, start: string, end: string }>
}

export async function createTeamBooking(input: CreateTeamBookingInput): Promise<TeamBookingCreationResult> {
  const { team, slug, start, durationMinutes, requestId, recurrence, name, email, guestEmails, timeZone, notes, answers, source, attribution, rescheduleOf } = input
  const eventType = await findPublicTeamEventType(team, slug)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
  if (recurrence && rescheduleOf) {
    throw createError({ statusCode: 400, statusMessage: 'A recurring series cannot be created while moving another booking.' })
  }

  const previous = rescheduleOf ? await findBookingByUid(rescheduleOf) : null
  const previousHosts = previous ? await assignedHostsForBooking(previous.id) : []
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
  const payment = await eventPaymentReadiness(eventType.id)
  const previousPayment = previous ? await paymentForBooking(previous.id) : null
  if (previousPayment && previousPayment.status !== 'paid') {
    throw createError({ statusCode: 409, statusMessage: 'Finish or cancel the existing payment before moving this booking.' })
  }
  const paymentCovered = previousPayment?.status === 'paid'
  const awaitingPayment = Boolean(payment && !paymentCovered)

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

  if (recurrence && requestId) {
    let recurring
    try {
      recurring = await createTeamRecurringBooking({
        eventType,
        hosts,
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
      if (error instanceof CalendarUnavailableError) {
        throw createError({
          statusCode: 503,
          statusMessage: 'Recurring times are temporarily unavailable. Please try again shortly.'
        })
      }
      throw error
    }
    return {
      ...recurring,
      hostNames: [],
      locationType: eventType.locationType,
      locationDetails: eventType.locationDetails,
      meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null
    }
  }

  const now = new Date().toISOString()
  const wanted = new Date(start).getTime()
  const wantedDate = utcCalendarDate(wanted)
  const day = (offset: number) => addUtcCalendarDays(wantedDate, offset)

  // Re-derive the slot rather than trusting the posted time, and re-derive it
  // now rather than reusing what the page was shown: a host can have become
  // busy between the calendar loading and this submission.
  let offered
  try {
    offered = await teamSlotsFor(eventType, hosts, day(-1), day(1), now, durationMinutes)
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
      const existingGroupHosts = groupSession?.occupiedSeats
        ? (await assignedHostsForGroupSessions([groupSession.id], tx)).map(host => host.userId)
        : []
      const assigned = existingGroupHosts.length
        ? existingGroupHosts.filter(userId => slot.hostIds.includes(userId))
        : await chooseHosts(eventType, slot, tx)
      if (existingGroupHosts.length && assigned.length !== existingGroupHosts.length) {
        throw createError({ statusCode: 409, statusMessage: 'That group session is no longer available.' })
      }
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

      await assertBookingLimits({
        executor: tx,
        eventTypeId: eventType.id,
        hosts: attending.map(host => ({
          userId: host.userId,
          timeZone: host.scheduleTimeZone ?? host.timeZone
        })),
        occurrences: [{ startsAt: slot.start, groupSessionId: groupSession?.id }],
        limits: {
          maxPerDay: eventType.maxPerDay,
          maxPerWeek: eventType.maxPerWeek,
          maxPerMonth: eventType.maxPerMonth
        }
      })

      const [created] = await tx.insert(bookings).values({
        organizationId: eventType.organizationId,
        eventTypeId: eventType.id,
        seriesId: previous?.seriesId ?? null,
        seriesPosition: previous?.seriesPosition ?? null,
        groupSessionId: groupSession?.id ?? null,
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
          reference: `booking-${uid}`
        }, tx)
      } else {
        if (paymentCovered && previous) {
          const moved = await movePaidBookingPayment(previous.id, created.id, tx)
          if (!moved) throw new Error('The existing booking payment could not be moved.')
        }
        await publishBookingEvent({
          type: previous ? 'booking_rescheduled' : eventType.requiresConfirmation ? 'booking_requested' : 'booking_created',
          organizationId: eventType.organizationId,
          bookingId: created.id,
          eventTypeId: eventType.id,
          payload: previous ? { previousBookingId: previous.id, paid: paymentCovered } : undefined
        }, tx)
      }

      const coHosts = assigned.filter(userId => userId !== organizer.userId)
      if (coHosts.length) {
        // The exclusion constraint fires here if any co-host was taken in the
        // moment between the availability check and this write.
        await tx.insert(bookingHosts).values(coHosts.map(userId => ({
          bookingId: created.id,
          groupSessionId: groupSession?.id ?? null,
          userId,
          isOrganizer: false,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end)
        })))
      }

      if (!awaitingPayment && !eventType.requiresConfirmation) await enqueueCalendarSync(created.id, 'upsert', tx)

      const notice = {
        uid,
        eventTitle: eventType.title,
        hostName: attending.length > 1
          ? `${eventType.organizationName} (${attending.map(host => host.name).join(', ')})`
          : organizer.name,
        hostUserId: organizer.userId,
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
          userId: host.userId,
          name: host.name,
          email: host.email,
          timeZone: host.scheduleTimeZone ?? host.timeZone,
          isOrganizer: host.userId === organizer.userId
        })),
        publicBookingPath: `/team/${encodeURIComponent(eventType.organizationSlug)}/${encodeURIComponent(eventType.slug)}`
      }

      if (!awaitingPayment) {
        if (previous) {
          await queueBookingRescheduledEmails(notice, {
            previousStartsAt: previous.startsAt.toISOString(),
            previousEndsAt: previous.endsAt.toISOString(),
            requiresConfirmation: eventType.requiresConfirmation,
            seriesPosition: previous.seriesPosition,
            previousHostRecipients: previousHosts
          }, tx)
          if (!eventType.requiresConfirmation) {
            await queueBookingEmails(notice, tx, { sendConfirmation: false })
          }
        } else if (eventType.requiresConfirmation) await queueBookingRequestEmails(notice, tx)
        else await queueBookingEmails(notice, tx)
      }
    })
  } catch (error) {
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
    status: awaitingPayment ? 'awaiting_payment' : eventType.requiresConfirmation ? 'pending' : 'confirmed',
    checkoutUrl: checkout?.checkoutUrl ?? null,
    paymentExpiresAt: checkout?.expiresAt ?? null,
    moved: Boolean(previous),
    hostNames: attending.map(host => host.name),
    locationType: eventType.locationType,
    locationDetails: eventType.locationDetails,
    meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null
  }
}
