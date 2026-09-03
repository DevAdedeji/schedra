import { analyticsQuerySchema } from '#shared/analytics'
import { organizationAccessRoles } from '#shared/organization-access'
import { recordAudit, requireOrganization } from '../../../../services/organization'
import { teamAnalyticsExportRows } from '../../../../services/team-analytics-export'

function csvCell(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : value == null ? '' : String(value)
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safeText) ? `"${safeText.replaceAll('"', '""')}"` : safeText
}

export default defineEventHandler(async (event) => {
  const context = await requireOrganization(event, getRouterParam(event, 'slug') ?? '')
  const parsed = await getValidatedQuery(event, analyticsQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid analytics range.' })

  const seesEverything = organizationAccessRoles[context.role].authorize({ booking: ['viewAll'] }).success
  const rows = await teamAnalyticsExportRows({
    organizationId: context.organization.id,
    visibleUserId: seesEverything ? undefined : context.userId
  }, parsed.data)

  const columns = Object.keys(rows[0] ?? {
    bookingId: '', createdAt: '', startsAt: '', endsAt: '', status: '', attendanceStatus: '', eventType: '', attendeeName: '',
    attendeeEmail: '', attendeeTimeZone: '', source: '', paymentStatus: '', amountCents: '', currency: '', platformFeeCents: ''
  })
  const csv = [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column as keyof typeof row])).join(','))
  ].join('\r\n')

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'team_analytics.exported',
    targetType: 'organization',
    targetId: context.organization.id,
    metadata: {
      scope: seesEverything ? 'team' : 'assigned',
      days: parsed.data.days,
      eventTypeId: parsed.data.eventTypeId ?? null,
      rows: rows.length
    }
  })

  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="schedra-${context.organization.slug}-bookings-${new Date().toISOString().slice(0, 10)}.csv"`,
    'cache-control': 'private, no-store'
  })
  return `\uFEFF${csv}`
})
