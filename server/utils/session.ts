import type { H3Event } from 'h3'
import { useAuth } from './auth'

// Named `getAuthSession` rather than `getSession` so it cannot be confused with
// h3's auto-imported helper of that name.
export async function getAuthSession(event: H3Event) {
  return useAuth().api.getSession({ headers: event.headers })
}

/** Throws 401 rather than returning null. For handlers that need a user. */
export async function requireAuthSession(event: H3Event) {
  const session = await getAuthSession(event)

  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  }

  return session
}
