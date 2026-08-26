import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { teamEventTypeSchema } from '#shared/validation'
import { eventTypes } from '../../../../database/schema'
import { useDatabase } from '../../../../database/index'
import { assertTeamWritable } from '../../../../services/entitlement'
import { requireTeamLocationIntegrations } from '../../../../services/event-location'
import { recordAudit, requireOrganizationPermission } from '../../../../services/organization'
import { replaceHosts, resolveHosts } from '../../../../services/team-event-type'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) {
    throw createError({ statusCode: 404, statusMessage: 'Event type not found' })
  }

  const context = await requireOrganizationPermission(event, slug, { eventType: ['update'] })
  await assertTeamWritable(context.organization.id)

  const parsed = await readValidatedBody(event, teamEventTypeSchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those event type details are not valid.'
    })
  }

  const { hosts, ...fields } = parsed.data
  const db = useDatabase()

  const resolvedHosts = await resolveHosts(context.organization.id, hosts)
  await requireTeamLocationIntegrations(
    resolvedHosts.filter(host => host.enabled).map(host => host.userId),
    fields.locationType
  )

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: eventTypes.id })
      .from(eventTypes)
      // Scoping by organization is what stops one team editing another's event.
      .where(and(eq(eventTypes.id, id), eq(eventTypes.organizationId, context.organization.id)))
      .limit(1)

    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Event type not found' })

    await tx.update(eventTypes)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(eq(eventTypes.id, id))

    await replaceHosts(id, context.organization.id, hosts, tx)
  }).catch((failure) => {
    const message = String((failure as { message?: string })?.message ?? '')
    if (message.includes('event_types_organization_slug_key')) {
      throw createError({ statusCode: 409, statusMessage: 'This team already has an event type with that link.' })
    }
    throw failure
  })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'event_type.updated',
    targetType: 'event_type',
    targetId: id,
    metadata: { assignmentMode: fields.assignmentMode, hosts: hosts.length }
  })

  return { id }
})
