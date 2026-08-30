import { storedPersonalBranding } from '../services/personal-branding'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return storedPersonalBranding(session.user.id)
})
