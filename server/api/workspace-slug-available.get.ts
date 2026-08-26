import { sql } from 'drizzle-orm'
import { organizationSlugSchema } from '#shared/billing'
import { organizationSlugHistory, organizations } from '../database/schema'
import { useDatabase } from '../utils/database'
import { enforceRateLimit } from '../utils/rate-limit'
import { requireAuthSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)
  await enforceRateLimit(event, { namespace: 'workspace-slug-available', limit: 60, windowSeconds: 60 })

  const parsed = organizationSlugSchema.safeParse(getQuery(event).slug ?? '')
  if (!parsed.success) {
    return {
      available: false,
      reason: 'invalid' as const,
      message: parsed.error.issues[0]?.message ?? 'Not valid'
    }
  }

  const db = useDatabase()
  const [[existing], [retired]] = await Promise.all([
    db.select({ id: organizations.id }).from(organizations)
      .where(sql`lower(${organizations.slug}) = ${parsed.data}`).limit(1),
    // A retired slug still resolves old booking links, so it stays reserved.
    db.select({ id: organizationSlugHistory.id }).from(organizationSlugHistory)
      .where(sql`lower(${organizationSlugHistory.slug}) = ${parsed.data}`).limit(1)
  ])

  return existing || retired
    ? { available: false, reason: 'taken' as const, message: 'Already taken' }
    : { available: true, reason: null, message: 'Available' }
})
