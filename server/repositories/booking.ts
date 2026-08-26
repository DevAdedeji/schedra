import { asc, desc, eq } from 'drizzle-orm'
import { bookingHosts, bookings, eventTypes, organizations, users } from '../database/schema'
import { useDatabase } from '../database/index'

/**
 * Booking persistence lives here so HTTP handlers and lifecycle services do
 * not need to know the join shape. The booking UID is a capability token: only
 * return fields deliberately exposed by the management page.
 */
export async function findBookingByUid(uid: string) {
  const [row] = await useDatabase()
    .select({
      id: bookings.id,
      organizationId: bookings.organizationId,
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
      hostUsername: users.username,
      organizationName: organizations.name,
      organizationSlug: organizations.slug
    })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .leftJoin(organizations, eq(organizations.id, bookings.organizationId))
    .where(eq(bookings.uid, uid))
    .limit(1)

  return row ?? null
}

export async function assignedHostsForBooking(bookingId: string) {
  return useDatabase()
    .select({
      userId: bookingHosts.userId,
      name: users.name,
      email: users.email,
      timeZone: users.timeZone,
      isOrganizer: bookingHosts.isOrganizer
    })
    .from(bookingHosts)
    .innerJoin(users, eq(users.id, bookingHosts.userId))
    .where(eq(bookingHosts.bookingId, bookingId))
    .orderBy(desc(bookingHosts.isOrganizer), asc(bookingHosts.createdAt), asc(bookingHosts.id))
}

export type ManagedBooking = NonNullable<Awaited<ReturnType<typeof findBookingByUid>>>
export type AssignedBookingHost = Awaited<ReturnType<typeof assignedHostsForBooking>>[number]
