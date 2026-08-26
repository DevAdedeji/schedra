import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { eventTypes } from '../../../../database/schema'
import { useDatabase } from '../../../../utils/database'
import { requireOrganization } from '../../../../utils/organization'
import { hostsForEventType } from '../../../../utils/team-event-types'

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
