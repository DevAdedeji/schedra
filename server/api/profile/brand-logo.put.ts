import { eq, sql } from 'drizzle-orm'
import { userBrandLogos, users } from '../../database/schema'
import { useDatabase } from '../../database'
import { assertPersonalPro } from '../../services/personal-entitlement'
import { requireAuthSession } from '../../services/session'
import { AVATAR_CONTENT_TYPES, avatarHash, MAX_AVATAR_BYTES, validAvatarBytes } from '../../utils/avatar'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await assertPersonalPro(session.user.id)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'logo' && part.filename)
  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'Choose a logo to upload.' })
  if (file.data.length > MAX_AVATAR_BYTES) throw createError({ statusCode: 413, statusMessage: 'Your logo must be 2 MB or smaller.' })

  const contentType = file.type?.toLowerCase() ?? ''
  if (!AVATAR_CONTENT_TYPES.includes(contentType as typeof AVATAR_CONTENT_TYPES[number]) || !validAvatarBytes(contentType, file.data)) {
    throw createError({ statusCode: 415, statusMessage: 'Use a valid JPG, PNG, or WebP logo.' })
  }

  const hash = avatarHash(file.data)
  const logoUrl = `/api/brand-logo/${session.user.id}?v=${hash.slice(0, 16)}`
  await useDatabase().transaction(async (tx) => {
    await tx.insert(userBrandLogos).values({
      userId: session.user.id,
      contentType,
      bytes: file.data,
      size: file.data.length,
      hash
    }).onConflictDoUpdate({
      target: userBrandLogos.userId,
      set: { contentType, bytes: file.data, size: file.data.length, hash, updatedAt: sql`now()` }
    })
    await tx.update(users).set({ brandLogoUrl: logoUrl, updatedAt: sql`now()` })
      .where(eq(users.id, session.user.id))
  })
  return { ok: true, logoUrl }
})
