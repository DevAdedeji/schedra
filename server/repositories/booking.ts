import { asc, desc, eq, sql } from 'drizzle-orm'
import { bookingHosts, bookings, bookingSeries, eventTypes, organizations, users } from '../database/schema'
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
      seriesId: bookings.seriesId,
      seriesPosition: bookings.seriesPosition,
      seriesOccurrenceCount: bookingSeries.occurrenceCount,
      seriesFrequency: bookingSeries.frequency,
      uid: bookings.uid,
      status: bookings.status,
      attendanceStatus: bookings.attendanceStatus,
      attendanceUpdatedAt: bookings.attendanceUpdatedAt,
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
      durationMinutes: sql<number>`extract(epoch from (${bookings.endsAt} - ${bookings.startsAt})) / 60`.mapWith(Number),
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
    .leftJoin(bookingSeries, eq(bookingSeries.id, bookings.seriesId))
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
