import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { organizationEventTemplateAssignments, organizationEventTemplates } from '../../../../database/schema'
import { useDatabase } from '../../../../database'
import { assertTeamWritable } from '../../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) throw createError({ statusCode: 404, statusMessage: 'Template not found.' })
  const context = await requireOrganizationPermission(event, slug, { eventType: ['delete'] })
  await assertTeamWritable(context.organization.id)

  const archived = await useDatabase().transaction(async (tx) => {
    const [row] = await tx.update(organizationEventTemplates).set({
      archivedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      eq(organizationEventTemplates.id, id),
      eq(organizationEventTemplates.organizationId, context.organization.id),
      isNull(organizationEventTemplates.archivedAt)
    )).returning({ id: organizationEventTemplates.id, name: organizationEventTemplates.name })
    if (!row) return null
    const detached = await tx.delete(organizationEventTemplateAssignments).where(and(
      eq(organizationEventTemplateAssignments.organizationId, context.organization.id),
      eq(organizationEventTemplateAssignments.templateId, id)
    )).returning({ id: organizationEventTemplateAssignments.id })
    return { ...row, detachedAssignments: detached.length }
  })
  if (!archived) throw createError({ statusCode: 404, statusMessage: 'Template not found.' })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'event_template.archived',
    targetType: 'event_template',
    targetId: id,
    metadata: { name: archived.name, detachedAssignments: archived.detachedAssignments }
  })
  return { id, archived: true }
})
