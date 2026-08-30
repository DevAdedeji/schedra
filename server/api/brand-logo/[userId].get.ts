import { eq } from 'drizzle-orm'
import { userBrandLogos } from '../../database/schema'
import { useDatabase } from '../../database'
import { personalPlanEntitlement } from '../../services/personal-entitlement'

export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId')
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found.' })
  }
  const entitlement = await personalPlanEntitlement(userId)
  if (!entitlement.isPro) throw createError({ statusCode: 404, statusMessage: 'Image not found.' })
  const [logo] = await useDatabase().select().from(userBrandLogos)
    .where(eq(userBrandLogos.userId, userId)).limit(1)
  if (!logo) throw createError({ statusCode: 404, statusMessage: 'Image not found.' })

  const etag = `"${logo.hash}"`
  if (getHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }
  setResponseHeaders(event, {
    'content-type': logo.contentType,
    'content-length': logo.size,
    'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    'etag': etag,
    'x-content-type-options': 'nosniff'
  })
  return logo.bytes
})
