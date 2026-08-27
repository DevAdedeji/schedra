import type { H3Event } from 'h3'
import { useAuth } from './auth'
import { useEnv } from '../config/env'

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

export function isPlatformAdminEmail(email: string, allowed = useEnv().platformAdminEmails) {
  return allowed.includes(email.trim().toLowerCase())
}

export async function requirePlatformAdminSession(event: H3Event) {
  const session = await requireAuthSession(event)
  if (!isPlatformAdminEmail(session.user.email)) {
    // Do not reveal that a private operations surface exists.
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return session
}
