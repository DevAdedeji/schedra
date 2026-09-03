import { z } from 'zod'
import { requirePlatformAdminSession } from '../../../services/session'
import { controlUserDetail } from '../../../services/control'

const idSchema = z.string().uuid()

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  const parsed = idSchema.safeParse(getRouterParam(event, 'id'))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid user.' })
  const detail = await controlUserDetail(parsed.data)
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'User not found.' })
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return detail
})
