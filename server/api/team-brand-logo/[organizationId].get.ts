import { eq } from 'drizzle-orm'
import { organizationBrandLogos, organizations } from '../../database/schema'
import { useDatabase } from '../../database'

export default defineEventHandler(async (event) => {
  const organizationId = getRouterParam(event, 'organizationId') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found.' })
  }
  const [logo] = await useDatabase().select({
    contentType: organizationBrandLogos.contentType,
    bytes: organizationBrandLogos.bytes,
    size: organizationBrandLogos.size,
    hash: organizationBrandLogos.hash,
    archivedAt: organizations.archivedAt
  }).from(organizationBrandLogos)
    .innerJoin(organizations, eq(organizations.id, organizationBrandLogos.organizationId))
    .where(eq(organizationBrandLogos.organizationId, organizationId)).limit(1)
  if (!logo || logo.archivedAt) throw createError({ statusCode: 404, statusMessage: 'Image not found.' })

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
