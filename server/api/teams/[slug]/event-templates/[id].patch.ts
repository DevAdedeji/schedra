import { z } from 'zod'
import { teamEventTemplateWriteSchema } from '#shared/validation'
import { assertTeamWritable } from '../../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../../services/organization'
import { snapshotTeamEventDefaults, updateTeamEventTemplate } from '../../../../services/team-event-template'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) throw createError({ statusCode: 404, statusMessage: 'Template not found.' })
  const context = await requireOrganizationPermission(event, slug, { eventType: ['update'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, teamEventTemplateWriteSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  const defaults = await snapshotTeamEventDefaults(context.organization.id, parsed.data.sourceEventTypeId)

  const updated = await updateTeamEventTemplate({
    id,
    organizationId: context.organization.id,
    name: parsed.data.name,
    defaults,
    sourceEventTypeId: parsed.data.sourceEventTypeId,
    createdByUserId: context.userId,
    assignmentMemberIds: parsed.data.assignmentMemberIds,
    memberEditableFields: parsed.data.memberEditableFields
  })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'event_template.updated',
    targetType: 'event_template',
    targetId: id,
    metadata: {
      name: parsed.data.name,
      sourceEventTypeId: parsed.data.sourceEventTypeId,
      assignedMembers: parsed.data.assignmentMemberIds.length,
      createdAssignments: updated.createdAssignments,
      updatedAssignments: updated.updatedAssignments,
      detachedAssignments: updated.detachedAssignments
    }
  })
  return { id }
})
