import { createBookingSchema } from '#shared/validation'
import { bookings } from '../database/schema'
import { useDatabase } from '../utils/database'
import { findPublicEventType, slotsFor } from '../utils/booking-page'
import { sendBookingEmails } from '../utils/booking-emails'

const SLOT_TAKEN = '23P01'

export default defineEventHandler(async (event) => {
  const parsed = await readValidatedBody(event, createBookingSchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those booking details are not valid.'
    })
  }

  const { username, slug, start, name, email, timeZone, notes } = parsed.data
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
  const offered = await slotsFor(eventType, day(-1), day(1), now)
  const slot = offered.find(candidate => new Date(candidate.start).getTime() === wanted)

  if (!slot) {
    throw createError({ statusCode: 409, statusMessage: 'That time is no longer available.' })
  }

  const uid = crypto.randomUUID()

  try {
    await useDatabase().insert(bookings).values({
      eventTypeId: eventType.id,
      hostId: eventType.hostId,
      uid,
      startsAt: new Date(slot.start),
      endsAt: new Date(slot.end),
      attendeeName: name,
      attendeeEmail: email,
      attendeeTimeZone: timeZone,
      answers: notes ? { notes } : null
    })
  } catch (error) {
    // Postgres rejected an overlap, which means someone else won the race.
    if ((error as { code?: string }).code === SLOT_TAKEN) {
      throw createError({ statusCode: 409, statusMessage: 'Someone just booked that time.' })
    }
    throw error
  }

  await sendBookingEmails({
    uid,
    eventTitle: eventType.title,
    hostName: eventType.hostName,
    hostEmail: eventType.hostEmail,
    hostTimeZone: eventType.scheduleTimeZone ?? eventType.hostTimeZone,
    attendeeName: name,
    attendeeEmail: email,
    attendeeTimeZone: timeZone,
    startsAt: slot.start,
    endsAt: slot.end
  })

  return { uid, start: slot.start, end: slot.end }
})
