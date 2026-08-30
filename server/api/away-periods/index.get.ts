import { listAwayPeriods } from '../../services/away-periods'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return listAwayPeriods(session.user.id)
})
