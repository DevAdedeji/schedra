import type { H3Event } from 'h3'
import { useAuth } from './auth'

export async function getAuthSession(event: H3Event) {
  return useAuth().api.getSession({ headers: event.headers })
}

export async function requireAuthSession(event: H3Event) {
  const session = await getAuthSession(event)

  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  }

  return session
}
