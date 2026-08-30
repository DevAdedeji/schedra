import { and, desc, eq, gte } from 'drizzle-orm'
import { analyticsQuerySchema } from '#shared/analytics'
import { bookingPayments, bookings, eventTypes } from '../../database/schema'
import { useDatabase } from '../../database'
import { assertPersonalPro } from '../../services/personal-entitlement'
import { recordSecurityAudit } from '../../services/security-audit'
import { requireAuthSession } from '../../services/session'
import { subtractFromInstant } from '../../utils/date-time'

function csvCell(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await assertPersonalPro(session.user.id)
  const parsed = await getValidatedQuery(event, analyticsQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid analytics range.' })

  const from = subtractFromInstant(new Date(), { hours: parsed.data.days * 24 })
  const rows = await useDatabase().select({
    bookingId: bookings.uid,
    createdAt: bookings.createdAt,
    startsAt: bookings.startsAt,
    endsAt: bookings.endsAt,
    status: bookings.status,
    eventType: eventTypes.title,
    attendeeName: bookings.attendeeName,
    attendeeEmail: bookings.attendeeEmail,
    attendeeTimeZone: bookings.attendeeTimeZone,
    source: bookings.source,
    paymentStatus: bookingPayments.status,
    amountCents: bookingPayments.amountCents,
    currency: bookingPayments.currency,
    platformFeeCents: bookingPayments.platformFeeCents
  }).from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .leftJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .where(and(
      eq(eventTypes.userId, session.user.id),
      gte(bookings.createdAt, from),
      parsed.data.eventTypeId ? eq(bookings.eventTypeId, parsed.data.eventTypeId) : undefined
    ))
    .orderBy(desc(bookings.createdAt))
    .limit(10_000)

  const columns = Object.keys(rows[0] ?? {
    bookingId: '', createdAt: '', startsAt: '', endsAt: '', status: '', eventType: '', attendeeName: '',
    attendeeEmail: '', attendeeTimeZone: '', source: '', paymentStatus: '', amountCents: '', currency: '', platformFeeCents: ''
  })
  const csv = [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column as keyof typeof row])).join(','))
  ].join('\r\n')

  await recordSecurityAudit({
    action: 'personal_analytics.exported',
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    targetType: 'user',
    targetId: session.user.id,
    metadata: { days: parsed.data.days, eventTypeId: parsed.data.eventTypeId ?? null, rows: rows.length }
  }, event)

  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="schedra-bookings-${new Date().toISOString().slice(0, 10)}.csv"`,
    'cache-control': 'private, no-store'
  })
  return `\uFEFF${csv}`
})
