import { eq, sql } from 'drizzle-orm'
import { userAvatars, users } from '../../database/schema'
import { AVATAR_CONTENT_TYPES, avatarHash, MAX_AVATAR_BYTES, validAvatarBytes } from '../../utils/avatar'
import { useDatabase } from '../../utils/database'
import { requireAuthSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'avatar' && part.filename)

  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'Choose an image to upload.' })
  if (file.data.length > MAX_AVATAR_BYTES) throw createError({ statusCode: 413, statusMessage: 'Your image must be 2 MB or smaller.' })

  const contentType = file.type?.toLowerCase() ?? ''
  if (!AVATAR_CONTENT_TYPES.includes(contentType as typeof AVATAR_CONTENT_TYPES[number]) || !validAvatarBytes(contentType, file.data)) {
    throw createError({ statusCode: 415, statusMessage: 'Use a valid JPG, PNG, or WebP image.' })
  }

  const hash = avatarHash(file.data)
  const avatarUrl = `/api/avatar/${session.user.id}?v=${hash.slice(0, 16)}`
  const db = useDatabase()
  await db.transaction(async (tx) => {
    await tx.insert(userAvatars).values({
      userId: session.user.id,
      contentType,
      bytes: file.data,
      size: file.data.length,
      hash
    }).onConflictDoUpdate({
      target: userAvatars.userId,
      set: { contentType, bytes: file.data, size: file.data.length, hash, updatedAt: sql`now()` }
    })
    await tx.update(users).set({ avatarUrl, updatedAt: sql`now()` }).where(eq(users.id, session.user.id))
  })
  return { ok: true, avatarUrl }
})
