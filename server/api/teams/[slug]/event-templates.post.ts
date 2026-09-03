import { teamEventTemplateWriteSchema } from '#shared/validation'
import { assertTeamWritable } from '../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../services/organization'
import { createTeamEventTemplate, snapshotTeamEventDefaults } from '../../../services/team-event-template'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { eventType: ['create'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, teamEventTemplateWriteSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  const defaults = await snapshotTeamEventDefaults(context.organization.id, parsed.data.sourceEventTypeId)
  const created = await createTeamEventTemplate({
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
    action: 'event_template.created',
    targetType: 'event_template',
    targetId: created.id,
    metadata: {
      name: parsed.data.name,
      sourceEventTypeId: parsed.data.sourceEventTypeId,
      assignedMembers: parsed.data.assignmentMemberIds.length,
      createdAssignments: created.createdAssignments
    }
  })
  setResponseStatus(event, 201)
  return { id: created.id }
})
