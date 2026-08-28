import { and, asc, eq, sql } from 'drizzle-orm'
import { eventTypes, users } from '../../database/schema'
import { useDatabase } from '../../database/index'
import { enforceRateLimit } from '../../services/rate-limit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'public-profile', limit: 180, windowSeconds: 60 })
  const username = getRouterParam(event, 'username')

  if (!username) {
    throw createError({ statusCode: 400, statusMessage: 'Missing username' })
  }

  const db = useDatabase()

  const [host] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      bio: users.bio,
      avatarUrl: users.avatarUrl
    })
    .from(users)
    .where(and(
      sql`lower(${users.username}) = ${username.toLowerCase()}`,
      eq(users.emailVerified, true)
    ))
    .limit(1)

  if (!host) {
    throw createError({ statusCode: 404, statusMessage: 'No such person' })
  }

  const types = await db
    .select({
      slug: eventTypes.slug,
      title: eventTypes.title,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      paymentEnabled: eventTypes.paymentEnabled,
      priceCents: eventTypes.priceCents,
      paymentCurrency: eventTypes.paymentCurrency
    })
    .from(eventTypes)
    .where(and(eq(eventTypes.userId, host.id), eq(eventTypes.hidden, false)))
    .orderBy(asc(eventTypes.durationMinutes))

  return {
    name: host.name,
    username: host.username,
    bio: host.bio,
    avatarUrl: host.avatarUrl,
    eventTypes: types
  }
})
