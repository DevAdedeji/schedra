import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  eventTypes,
  members,
  organizationEventTemplateAssignments,
  organizationEventTemplates
} from '../../../../database/schema'
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

  const [managed] = await useDatabase().select({
    templateId: organizationEventTemplateAssignments.templateId,
    templateName: organizationEventTemplates.name,
    assignedUserId: members.userId,
    memberEditableFields: organizationEventTemplates.memberEditableFields
  }).from(organizationEventTemplateAssignments)
    .innerJoin(organizationEventTemplates, eq(organizationEventTemplates.id, organizationEventTemplateAssignments.templateId))
    .innerJoin(members, eq(members.id, organizationEventTemplateAssignments.memberId))
    .where(and(
      eq(organizationEventTemplateAssignments.organizationId, context.organization.id),
      eq(organizationEventTemplateAssignments.eventTypeId, id)
    )).limit(1)

  return {
    ...eventType,
    hosts: await hostsForEventType(id),
    managed: managed
      ? {
          ...managed,
          canPersonalize: Boolean(managed.memberEditableFields.length
            && (managed.assignedUserId === context.userId || context.role !== 'member'))
        }
      : null
  }
})
