import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { organizationSlugSchema } from '#shared/billing'
import { organizationSlugHistory, organizations } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { recordAudit, requireOrganizationPermission } from '../../../utils/organization'

const bodySchema = z.object({ slug: organizationSlugSchema })

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { slug: ['update'] })

  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'That team address is not valid.'
    })
  }

  const next = parsed.data.slug
  const previous = context.organization.slug
  if (next === previous.toLowerCase()) return { slug: previous }

  const db = useDatabase()

  await db.transaction(async (tx) => {
    const [takenByOrg] = await tx.select({ id: organizations.id }).from(organizations)
      .where(sql`lower(${organizations.slug}) = ${next}`).limit(1)
    const [takenByHistory] = await tx.select({ id: organizationSlugHistory.id }).from(organizationSlugHistory)
      .where(sql`lower(${organizationSlugHistory.slug}) = ${next}`).limit(1)

    if (takenByOrg || takenByHistory) {
      throw createError({ statusCode: 409, statusMessage: 'That team address is already taken.' })
    }

    // Recording the old slug first keeps every shared /team link resolving.
    await tx.insert(organizationSlugHistory)
      .values({ organizationId: context.organization.id, slug: previous })
      .onConflictDoNothing()

    await tx.update(organizations)
      .set({ slug: next, updatedAt: sql`now()` })
      .where(eq(organizations.id, context.organization.id))
  })

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'organization.address_changed',
    metadata: { from: previous, to: next }
  })

  return { slug: next }
})
