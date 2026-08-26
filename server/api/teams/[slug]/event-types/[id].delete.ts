import { and, eq, gte, inArray } from 'drizzle-orm'
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

  // Guests hold links to these meetings, so an event with live bookings is
  // hidden rather than deleted; bookings reference it with onDelete restrict.
  const [upcoming] = await db.select({ id: bookings.id })
    .from(bookings)
    .where(and(
      eq(bookings.eventTypeId, id),
      inArray(bookings.status, ['pending', 'confirmed']),
      gte(bookings.endsAt, new Date())
    ))
    .limit(1)

  if (upcoming) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This event type has upcoming bookings. Hide it instead, or cancel them first.'
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
