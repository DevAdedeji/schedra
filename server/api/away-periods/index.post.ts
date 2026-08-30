import { awayPeriodInputSchema } from '#shared/away-periods'
import { createAwayPeriod } from '../../services/away-periods'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, awayPeriodInputSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check these dates.' })
  }
  try {
    return await createAwayPeriod(session.user.id, parsed.data)
  } catch (failure) {
    if ((failure as { code?: string }).code === '23P01') {
      throw createError({ statusCode: 409, statusMessage: 'This time off overlaps another away period.' })
    }
    throw failure
  }
})
