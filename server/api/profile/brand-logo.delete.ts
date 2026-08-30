import { eq, sql } from 'drizzle-orm'
import { userBrandLogos, users } from '../../database/schema'
import { useDatabase } from '../../database'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await useDatabase().transaction(async (tx) => {
    await tx.delete(userBrandLogos).where(eq(userBrandLogos.userId, session.user.id))
    await tx.update(users).set({ brandLogoUrl: null, updatedAt: sql`now()` })
      .where(eq(users.id, session.user.id))
  })
  return { ok: true }
})
