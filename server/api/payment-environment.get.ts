import { useEnv } from '../config/env'

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return { mode: useEnv().billingMode }
})
