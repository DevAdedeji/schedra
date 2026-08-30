import { and, count, eq, isNull } from 'drizzle-orm'
import { teamEventTemplateWriteSchema } from '#shared/validation'
import { organizationEventTemplates } from '../../../database/schema'
import { useDatabase } from '../../../database'
import { assertTeamWritable } from '../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../services/organization'
import { snapshotTeamEventDefaults } from '../../../services/team-event-template'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { eventType: ['create'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, teamEventTemplateWriteSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  const defaults = await snapshotTeamEventDefaults(context.organization.id, parsed.data.sourceEventTypeId)
  const db = useDatabase()
  const [total] = await db.select({ value: count() }).from(organizationEventTemplates).where(and(
    eq(organizationEventTemplates.organizationId, context.organization.id),
    isNull(organizationEventTemplates.archivedAt)
  ))
  if ((total?.value ?? 0) >= 50) {
    throw createError({ statusCode: 409, statusMessage: 'Archive an old template before creating another.' })
  }

  const [created] = await db.insert(organizationEventTemplates).values({
    organizationId: context.organization.id,
    name: parsed.data.name,
    defaults,
    sourceEventTypeId: parsed.data.sourceEventTypeId,
    createdByUserId: context.userId
  }).returning({ id: organizationEventTemplates.id }).catch(rethrowTemplateNameConflict)
  if (!created) throw createError({ statusCode: 500, statusMessage: 'Could not create that template.' })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'event_template.created',
    targetType: 'event_template',
    targetId: created.id,
    metadata: { name: parsed.data.name, sourceEventTypeId: parsed.data.sourceEventTypeId }
  })
  setResponseStatus(event, 201)
  return { id: created.id }
})

function rethrowTemplateNameConflict(failure: unknown): never {
  if (String((failure as { message?: string })?.message ?? '').includes('organization_event_templates_active_name_key')) {
    throw createError({ statusCode: 409, statusMessage: 'An active template already uses that name.' })
  }
  throw failure
}
