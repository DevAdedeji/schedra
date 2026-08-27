import { useEnv } from '../config/env'
import { createJobRuntime } from '../services/job-runtime'

const WORKER_HEALTH_PATHS = new Set(['/api/healthz', '/api/readyz'])

export default defineNitroPlugin(async (nitro) => {
  if (import.meta.prerender) return
  const role = useEnv().processRole
  if (role === 'web') return

  if (role === 'worker') {
    // The shared Nitro bundle contains prerendered pages, so enforce isolation
    // at the final response boundary rather than relying on route middleware.
    nitro.hooks.hook('beforeResponse', (event, response) => {
      if (WORKER_HEALTH_PATHS.has(getRequestURL(event).pathname)) return
      setResponseStatus(event, 404, 'Not Found')
      response.body = { statusCode: 404, statusMessage: 'Not found' }
      removeResponseHeader(event, 'Content-Length')
      setResponseHeader(event, 'Cache-Control', 'no-store')
      setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
    })
  }

  const runtime = createJobRuntime({ role })
  await runtime.start()

  nitro.hooks.hook('close', () => runtime.stop())
})
