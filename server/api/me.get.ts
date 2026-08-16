import { getAuthSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) return { user: null }

  const { id, name, email, username, timeZone } = session.user

  return { user: { id, name, email, username, timeZone } }
})
