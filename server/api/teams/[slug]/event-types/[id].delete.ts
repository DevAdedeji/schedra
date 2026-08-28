import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { bookings, eventTypes } from '../../../../database/schema'
import { useDatabase } from '../../../../database/index'
import { recordAudit, requireOrganizationPermission } from '../../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) {
    throw createError({ statusCode: 404, statusMessage: 'Event type not found' })
  }

  const context = await requireOrganizationPermission(event, slug, { eventType: ['delete'] })
  const db = useDatabase()

  const [existing] = await db.select({ id: eventTypes.id, slug: eventTypes.slug })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id), eq(eventTypes.organizationId, context.organization.id)))
    .limit(1)

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Event type not found' })

  // Keep every historical management link resolvable. The FK is restrictive
  // by design, so the API explains the safe alternative before Postgres does.
  const [history] = await db.select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.eventTypeId, id))
    .limit(1)

  if (history) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This event type has booking history. Hide it instead so past booking links keep working.'
    })
  }

  await db.delete(eventTypes).where(eq(eventTypes.id, id))

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'event_type.deleted',
    targetType: 'event_type',
    targetId: id,
    metadata: { slug: existing.slug }
  })

  return { ok: true }
})
