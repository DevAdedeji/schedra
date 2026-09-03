import { and, eq, isNull, lte, sql } from 'drizzle-orm'
import { updateBookingAttendanceSchema } from '#shared/validation'
import { bookings } from '../../../database/schema'
import { useDatabase } from '../../../database'
import { assignedHostsForBooking, findBookingByUid } from '../../../repositories/booking'
import { recordSecurityAudit } from '../../../services/security-audit'
import { requireAuthSession } from '../../../services/session'
import { publishBookingEvent } from '../../../services/workflows'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const uid = getRouterParam(event, 'uid')
  const parsed = await readValidatedBody(event, updateBookingAttendanceSchema.safeParse)

  if (!uid || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a valid attendance outcome.' })
  }

  const booking = await findBookingByUid(uid)
  if (!booking) throw createError({ statusCode: 404, statusMessage: 'No such booking.' })

  const hosts = await assignedHostsForBooking(booking.id)
  if (!hosts.some(host => host.userId === session.user.id)) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking.' })
  }
  if (booking.status !== 'confirmed') {
    throw createError({ statusCode: 409, statusMessage: 'Only confirmed bookings can have an attendance outcome.' })
  }
  if (booking.startsAt > new Date()) {
    throw createError({ statusCode: 409, statusMessage: 'Attendance can be recorded after the meeting starts.' })
  }
  if (booking.attendanceStatus === parsed.data.status) {
    return { status: booking.attendanceStatus, unchanged: true }
  }

  const result = await useDatabase().transaction(async (tx) => {
    const [updated] = await tx.update(bookings).set({
      attendanceStatus: parsed.data.status,
      attendanceUpdatedAt: parsed.data.status ? sql`now()` : null,
      attendanceUpdatedByUserId: parsed.data.status ? session.user.id : null,
      updatedAt: sql`now()`
    }).where(and(
      eq(bookings.id, booking.id),
      eq(bookings.status, 'confirmed'),
      lte(bookings.startsAt, sql`now()`),
      booking.attendanceStatus === null
        ? isNull(bookings.attendanceStatus)
        : eq(bookings.attendanceStatus, booking.attendanceStatus)
    )).returning({ status: bookings.attendanceStatus })

    if (!updated) {
      const [current] = await tx.select({ status: bookings.attendanceStatus })
        .from(bookings)
        .where(eq(bookings.id, booking.id))
        .limit(1)
      if (current?.status === parsed.data.status) {
        return { status: current.status, unchanged: true }
      }
      throw createError({ statusCode: 409, statusMessage: 'Another host changed this outcome. Refresh and try again.' })
    }

    if (updated.status === 'no_show') {
      await publishBookingEvent({
        type: 'booking_no_show',
        ...(booking.organizationId ? { organizationId: booking.organizationId } : { userId: booking.hostId }),
        bookingId: booking.id,
        eventTypeId: booking.eventTypeId,
        payload: { previousStatus: booking.attendanceStatus, status: updated.status }
      }, tx)
    }
    await recordSecurityAudit({
      action: 'booking.attendance_updated',
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      organizationId: booking.organizationId,
      targetType: 'booking',
      targetId: booking.id,
      metadata: { previousStatus: booking.attendanceStatus, status: updated.status }
    }, event, tx)

    return { status: updated.status, unchanged: false }
  })

  return result
})
