import { z } from 'zod'
import { emailSchema, timeZoneSchema } from '#shared/validation'
import { bookingHosts, bookings } from '../database/schema'
import { useDatabase } from '../utils/database'
import {
  activeHostsFor,
  chooseHosts,
  findPublicTeamEventType,
  teamSlotsFor
} from '../utils/team-booking-page'
import { queueBookingEmails, queueBookingRequestEmails } from '../utils/booking-emails'
import { enforceRateLimit } from '../utils/rate-limit'
import { enqueueCalendarSync } from '../utils/calendar-sync'
import { CalendarUnavailableError } from '../utils/google-calendar'
import { BookingAnswerValidationError, buildBookingAnswersSnapshot } from '../utils/booking-answers'

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
  answers: z.record(z.string().trim().min(1).max(64), z.string().trim().max(2000)).optional()
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

  const { team, slug, start, name, email, guestEmails, timeZone, notes, answers } = parsed.data
  const eventType = await findPublicTeamEventType(team, slug)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })

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

  const assigned = await chooseHosts(eventType, slot)
  if (!assigned.length) {
    throw createError({ statusCode: 409, statusMessage: 'That time is no longer available.' })
  }

  const organizer = hosts.find(host => host.userId === assigned[0])!
  const attending = hosts.filter(host => assigned.includes(host.userId))
  const uid = crypto.randomUUID()

  try {
    await useDatabase().transaction(async (tx) => {
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
        answers: answerSnapshot
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
        // Co-hosts are attendees on the guest's confirmation, so everyone who
        // is expected in the meeting can see who else will be there.
        additionalGuestEmails: [
          ...additionalGuestEmails,
          ...attending.filter(host => host.userId !== organizer.userId).map(host => host.email)
        ],
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
    hostNames: attending.map(host => host.name),
    locationType: eventType.locationType,
    locationDetails: eventType.locationDetails,
    meetingUrl: eventType.locationType === 'video_link' ? eventType.locationDetails : null
  }
})
