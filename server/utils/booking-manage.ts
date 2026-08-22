import { eq } from 'drizzle-orm'
import { bookings, eventTypes, users } from '../database/schema'
import { useDatabase } from './database'

export async function findBookingByUid(uid: string) {
  const [row] = await useDatabase()
    .select({
      id: bookings.id,
      uid: bookings.uid,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      attendeeName: bookings.attendeeName,
      attendeeEmail: bookings.attendeeEmail,
      attendeeTimeZone: bookings.attendeeTimeZone,
      cancellationReason: bookings.cancellationReason,
      eventTitle: eventTypes.title,
      eventSlug: eventTypes.slug,
      durationMinutes: eventTypes.durationMinutes,
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
