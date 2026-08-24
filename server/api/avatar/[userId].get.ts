import { eq } from 'drizzle-orm'
import { userAvatars } from '../../database/schema'
import { useDatabase } from '../../utils/database'

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId')
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found.' })
  }
  const [avatar] = await useDatabase().select().from(userAvatars).where(eq(userAvatars.userId, userId)).limit(1)
  if (!avatar) throw createError({ statusCode: 404, statusMessage: 'Image not found.' })

  const etag = `"${avatar.hash}"`
  if (getHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }
  setResponseHeaders(event, {
    'content-type': avatar.contentType,
    'content-length': avatar.size,
    'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    'etag': etag,
    'x-content-type-options': 'nosniff'
  })
  return avatar.bytes
})
