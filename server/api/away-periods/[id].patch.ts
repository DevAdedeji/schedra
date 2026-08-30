import { z } from 'zod'
import { awayPeriodInputSchema } from '#shared/away-periods'
import { updateAwayPeriod } from '../../services/away-periods'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid away period.' })
  const parsed = await readValidatedBody(event, awayPeriodInputSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check these dates.' })
  }
  try {
    const updated = await updateAwayPeriod(session.user.id, id.data, parsed.data)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Away period not found.' })
    return updated
  } catch (failure) {
    if ((failure as { code?: string }).code === '23P01') {
      throw createError({ statusCode: 409, statusMessage: 'This time off overlaps another away period.' })
    }
    throw failure
  }
})
