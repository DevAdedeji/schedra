import { sql } from 'drizzle-orm'
import { usernameSchema } from '../../shared/validation'
import { users } from '../database/schema'
import { useDatabase } from '../database/index'
import { enforceRateLimit } from '../services/rate-limit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'username-available', limit: 60, windowSeconds: 60 })
  const parsed = usernameSchema.safeParse(getQuery(event).username ?? '')

  if (!parsed.success) {
    return {
      available: false,
      reason: 'invalid' as const,
      message: parsed.error.issues[0]?.message ?? 'Not valid'
    }
  }

  const [existing] = await useDatabase()
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${parsed.data}`)
    .limit(1)

  return existing
    ? { available: false, reason: 'taken' as const, message: 'Already taken' }
    : { available: true, reason: null, message: 'Available' }
})
