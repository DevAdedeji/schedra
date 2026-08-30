import { eq, sql } from 'drizzle-orm'
import { organizationBrandLogos, organizations } from '../../../database/schema'
import { useDatabase } from '../../../database'
import { assertTeamWritable } from '../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../services/organization'
import { AVATAR_CONTENT_TYPES, avatarHash, MAX_AVATAR_BYTES, validAvatarBytes } from '../../../utils/avatar'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { organization: ['update'] })
  await assertTeamWritable(context.organization.id)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'logo' && part.filename)
  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'Choose a logo to upload.' })
  if (file.data.length > MAX_AVATAR_BYTES) throw createError({ statusCode: 413, statusMessage: 'Your logo must be 2 MB or smaller.' })

  const contentType = file.type?.toLowerCase() ?? ''
  if (!AVATAR_CONTENT_TYPES.includes(contentType as typeof AVATAR_CONTENT_TYPES[number]) || !validAvatarBytes(contentType, file.data)) {
    throw createError({ statusCode: 415, statusMessage: 'Use a valid JPG, PNG, or WebP logo.' })
  }

  const hash = avatarHash(file.data)
  const logoUrl = `/api/team-brand-logo/${context.organization.id}?v=${hash.slice(0, 16)}`
  await useDatabase().transaction(async (tx) => {
    await tx.insert(organizationBrandLogos).values({
      organizationId: context.organization.id,
      contentType,
      bytes: file.data,
      size: file.data.length,
      hash
    }).onConflictDoUpdate({
      target: organizationBrandLogos.organizationId,
      set: { contentType, bytes: file.data, size: file.data.length, hash, updatedAt: sql`now()` }
    })
    await tx.update(organizations).set({ logo: logoUrl, updatedAt: sql`now()` })
      .where(eq(organizations.id, context.organization.id))
  })
  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'organization.logo_updated',
    targetType: 'organization',
    targetId: context.organization.id
  })
  return { ok: true, logoUrl }
})
