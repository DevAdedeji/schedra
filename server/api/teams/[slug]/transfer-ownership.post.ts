import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { members, users } from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { recordAudit, requireOrganizationPermission } from '../../../services/organization'

const bodySchema = z.object({ memberId: z.uuid() })

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { ownership: ['transfer'] })

  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose who should become the owner.' })

  const db = useDatabase()

  const [target] = await db
    .select({ id: members.id, userId: members.userId, role: members.role, email: users.email, name: users.name })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.id, parsed.data.memberId), eq(members.organizationId, context.organization.id)))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, statusMessage: 'That person is not in this team.' })
  if (target.userId === context.userId) {
    throw createError({ statusCode: 400, statusMessage: 'You already own this team.' })
  }

  // Both writes must land together — a team with two owners or none is
  // worse than a failed transfer.
  await db.transaction(async (tx) => {
    await tx.update(members)
      .set({ role: 'owner' })
      .where(eq(members.id, target.id))

    await tx.update(members)
      .set({ role: 'admin' })
      .where(and(
        eq(members.organizationId, context.organization.id),
        eq(members.userId, context.userId)
      ))
  })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'organization.ownership_transferred',
    targetType: 'member',
    targetId: target.id,
    metadata: { to: target.email, previousOwner: context.userEmail }
  })

  return { ownerMemberId: target.id, yourRole: 'admin' as const }
})
