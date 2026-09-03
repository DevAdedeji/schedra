import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { teamEventTypeSchema } from '#shared/validation'
import { organizationAccessRoles } from '#shared/organization-access'
import { eventTypes } from '../../../../database/schema'
import { useDatabase } from '../../../../database/index'
import { assertTeamWritable } from '../../../../services/entitlement'
import { requireTeamLocationIntegrations } from '../../../../services/event-location'
import { recordAudit, requireOrganization } from '../../../../services/organization'
import { managedEventAssignment } from '../../../../services/team-event-template'
import { replaceHosts, resolveHosts } from '../../../../services/team-event-type'
import { requirePaymentRecipient } from '../../../../services/paid-booking'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) {
    throw createError({ statusCode: 404, statusMessage: 'Event type not found' })
  }

  const context = await requireOrganization(event, slug)
  await assertTeamWritable(context.organization.id)

  const parsed = await readValidatedBody(event, teamEventTypeSchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those event type details are not valid.'
    })
  }

  const { hosts, ...fields } = parsed.data
  const managed = await managedEventAssignment(context.organization.id, id)
  if (managed) {
    const canManageAll = organizationAccessRoles[context.role].authorize({ eventType: ['update'] }).success
    if (!canManageAll && managed.assignedUserId !== context.userId) {
      throw createError({ statusCode: 403, statusMessage: 'You can only personalize a managed event assigned to you.' })
    }
    if (!managed.memberEditableFields.length) {
      throw createError({ statusCode: 403, statusMessage: 'This managed event is fully controlled by the team administrator.' })
    }

    const personalizable = {
      description: fields.description ?? null,
      locationDetails: fields.locationDetails,
      hidden: fields.hidden
    }
    const updates = Object.fromEntries(
      managed.memberEditableFields.map(field => [field, personalizable[field]])
    )
    await useDatabase().update(eventTypes).set({ ...updates, updatedAt: sql`now()` }).where(and(
      eq(eventTypes.id, id),
      eq(eventTypes.organizationId, context.organization.id)
    ))
    await recordAudit({
      organizationId: context.organization.id,
      actorUserId: context.userId,
      actorEmail: context.userEmail,
      action: 'managed_event.personalized',
      targetType: 'event_type',
      targetId: id,
      metadata: { templateId: managed.templateId, fields: managed.memberEditableFields }
    })
    return { id }
  }

  const canManage = organizationAccessRoles[context.role].authorize({ eventType: ['update'] }).success
  if (!canManage) throw createError({ statusCode: 403, statusMessage: 'You do not have permission to do that in this team.' })
  await requirePaymentRecipient({ organizationId: context.organization.id }, fields.paymentEnabled)
  const db = useDatabase()

  const resolvedHosts = await resolveHosts(context.organization.id, hosts)
  const integrationHosts = resolvedHosts.filter(host => host.enabled)
  await requireTeamLocationIntegrations(
    (fields.locationType === 'zoom' && fields.assignmentMode === 'collective'
      ? integrationHosts.slice(0, 1)
      : integrationHosts).map(host => host.userId),
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
