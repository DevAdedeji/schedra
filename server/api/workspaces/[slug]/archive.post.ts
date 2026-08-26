import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { bookings, organizationSubscriptions, organizations } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { recordAudit, requireOrganizationPermission } from '../../../utils/organization'

const bodySchema = z.object({ confirmation: z.string().trim() })

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { organization: ['delete'] })

  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success || parsed.data.confirmation !== context.organization.slug) {
    throw createError({
      statusCode: 400,
      statusMessage: `Type ${context.organization.slug} to confirm archiving this workspace.`
    })
  }

  const db = useDatabase()
  const now = new Date()

  const cancelled = await db.transaction(async (tx) => {
    // Guests holding a team booking must not simply find a dead link, so
    // upcoming ones are cancelled rather than orphaned.
    const affected = await tx.update(bookings)
      .set({
        status: 'cancelled',
        cancellationReason: 'This workspace was archived.',
        updatedAt: sql`now()`
      })
      .where(and(
        eq(bookings.organizationId, context.organization.id),
        inArray(bookings.status, ['pending', 'confirmed']),
        gte(bookings.endsAt, now)
      ))
      .returning({ uid: bookings.uid })

    await tx.update(organizationSubscriptions)
      .set({ status: 'canceled', cancelAtPeriodEnd: true, updatedAt: sql`now()` })
      .where(eq(organizationSubscriptions.organizationId, context.organization.id))

    // The slug stays on the archived row so nobody can claim it and inherit
    // traffic from links the old workspace shared.
    await tx.update(organizations)
      .set({ archivedAt: now, updatedAt: sql`now()` })
      .where(eq(organizations.id, context.organization.id))

    return affected
  })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'organization.archived',
    metadata: { cancelledBookings: cancelled.length }
  })

  return { archived: true, cancelledBookings: cancelled.length }
})
