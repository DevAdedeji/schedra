import { eq, sql } from 'drizzle-orm'
import { organizationBrandLogos, organizations } from '../../../database/schema'
import { useDatabase } from '../../../database'
import { assertTeamWritable } from '../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { organization: ['update'] })
  await assertTeamWritable(context.organization.id)
  await useDatabase().transaction(async (tx) => {
    await tx.delete(organizationBrandLogos).where(eq(organizationBrandLogos.organizationId, context.organization.id))
    await tx.update(organizations).set({ logo: null, updatedAt: sql`now()` })
      .where(eq(organizations.id, context.organization.id))
  })
  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'organization.logo_removed',
    targetType: 'organization',
    targetId: context.organization.id
  })
  return { ok: true }
})
