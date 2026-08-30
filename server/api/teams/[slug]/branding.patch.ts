import { eq, sql } from 'drizzle-orm'
import { organizationBrandingSchema } from '#shared/branding'
import { organizations } from '../../../database/schema'
import { useDatabase } from '../../../database'
import { assertTeamWritable } from '../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../services/organization'
import { storedTeamBranding } from '../../../services/team-branding'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { organization: ['update'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, organizationBrandingSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check those branding settings.' })
  }

  await useDatabase().update(organizations).set({
    brandColor: parsed.data.brandColor,
    brandDarkColor: parsed.data.brandDarkColor,
    bookingPageTheme: parsed.data.bookingPageTheme,
    hideSchedraBranding: parsed.data.hideSchedraBranding,
    updatedAt: sql`now()`
  }).where(eq(organizations.id, context.organization.id))

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'organization.branding_updated',
    targetType: 'organization',
    targetId: context.organization.id
  })
  return { branding: await storedTeamBranding(context.organization.id) }
})
