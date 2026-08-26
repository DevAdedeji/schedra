import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { eventTypes } from '../../../../database/schema'
import { useDatabase } from '../../../../database/index'
import { requireOrganization } from '../../../../services/organization'
import { hostsForEventType } from '../../../../services/team-event-type'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) {
    throw createError({ statusCode: 404, statusMessage: 'Event type not found' })
  }

  const context = await requireOrganization(event, slug)

  const [eventType] = await useDatabase().select()
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id), eq(eventTypes.organizationId, context.organization.id)))
    .limit(1)

  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'Event type not found' })

  return { ...eventType, hosts: await hostsForEventType(id) }
})
