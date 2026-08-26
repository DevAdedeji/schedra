import { teamEventTypeSchema } from '#shared/validation'
import { eventTypes } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { assertTeamWritable } from '../../../utils/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../utils/organization'
import { replaceHosts } from '../../../utils/team-event-types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { eventType: ['create'] })
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

  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(eventTypes).values({
      ...fields,
      organizationId: context.organization.id,
      // The creator owns the row; who actually hosts is the host set.
      userId: context.userId
    }).returning({ id: eventTypes.id, slug: eventTypes.slug })

    if (!row) throw createError({ statusCode: 500, statusMessage: 'Could not create that event type.' })

    await replaceHosts(row.id, context.organization.id, hosts, tx)
    return row
  }).catch(rethrowSlugConflict)

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'event_type.created',
    targetType: 'event_type',
    targetId: created.id,
    metadata: { slug: created.slug, assignmentMode: fields.assignmentMode, hosts: hosts.length }
  })

  setResponseStatus(event, 201)
  return created
})

function rethrowSlugConflict(failure: unknown): never {
  const message = String((failure as { message?: string })?.message ?? '')
  if (message.includes('event_types_organization_slug_key')) {
    throw createError({ statusCode: 409, statusMessage: 'This team already has an event type with that link.' })
  }
  throw failure
}
