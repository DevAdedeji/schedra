import { eq } from 'drizzle-orm'
import { bookings, eventTypes, users } from '../database/schema'
import { useDatabase } from './database'

export async function findBookingByUid(uid: string) {
  const [row] = await useDatabase()
    .select({
      id: bookings.id,
      hostId: bookings.hostId,
      eventTypeId: bookings.eventTypeId,
      uid: bookings.uid,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      attendeeName: bookings.attendeeName,
      attendeeEmail: bookings.attendeeEmail,
      attendeeTimeZone: bookings.attendeeTimeZone,
      additionalGuestEmails: bookings.additionalGuestEmails,
      locationType: bookings.locationType,
      locationDetails: bookings.locationDetails,
      meetingUrl: bookings.meetingUrl,
      cancellationReason: bookings.cancellationReason,
      answers: bookings.answers,
      eventTitle: eventTypes.title,
      eventSlug: eventTypes.slug,
      durationMinutes: eventTypes.durationMinutes,
      reminderMinutes: eventTypes.reminderMinutes,
      requiresConfirmation: eventTypes.requiresConfirmation,
      hostName: users.name,
      hostEmail: users.email,
      hostTimeZone: users.timeZone,
      hostUsername: users.username
    })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .where(eq(bookings.uid, uid))
    .limit(1)

  return row ?? null
}

export type ManagedBooking = NonNullable<Awaited<ReturnType<typeof findBookingByUid>>>
