import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { teamEventTemplateWriteSchema } from '#shared/validation'
import { organizationEventTemplates } from '../../../../database/schema'
import { useDatabase } from '../../../../database'
import { assertTeamWritable } from '../../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../../services/organization'
import { snapshotTeamEventDefaults } from '../../../../services/team-event-template'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) throw createError({ statusCode: 404, statusMessage: 'Template not found.' })
  const context = await requireOrganizationPermission(event, slug, { eventType: ['update'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, teamEventTemplateWriteSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  const defaults = await snapshotTeamEventDefaults(context.organization.id, parsed.data.sourceEventTypeId)

  const [updated] = await useDatabase().update(organizationEventTemplates).set({
    name: parsed.data.name,
    defaults,
    sourceEventTypeId: parsed.data.sourceEventTypeId,
    updatedAt: sql`now()`
  }).where(and(
    eq(organizationEventTemplates.id, id),
    eq(organizationEventTemplates.organizationId, context.organization.id),
    isNull(organizationEventTemplates.archivedAt)
  )).returning({ id: organizationEventTemplates.id }).catch(rethrowTemplateNameConflict)
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Template not found.' })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'event_template.updated',
    targetType: 'event_template',
    targetId: id,
    metadata: { name: parsed.data.name, sourceEventTypeId: parsed.data.sourceEventTypeId }
  })
  return { id }
})

function rethrowTemplateNameConflict(failure: unknown): never {
  if (String((failure as { message?: string })?.message ?? '').includes('organization_event_templates_active_name_key')) {
    throw createError({ statusCode: 409, statusMessage: 'An active template already uses that name.' })
  }
  throw failure
}
