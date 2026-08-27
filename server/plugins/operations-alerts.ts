import { evaluateOperationsAlerts } from '../services/operations-alerts'
import { logEvent } from '../observability/logger'

const INTERVAL_MS = 60_000

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return
  let running = false
  const evaluate = async () => {
    if (running) return
    running = true
    try {
      await evaluateOperationsAlerts()
    } catch (error) {
      logEvent('error', 'operations_alert_evaluation_failed', { error })
    } finally {
      running = false
    }
  }

  const initial = setTimeout(evaluate, 15_000)
  initial.unref()
  const timer = setInterval(evaluate, INTERVAL_MS)
  timer.unref()
  nitro.hooks.hook('close', () => {
    clearTimeout(initial)
    clearInterval(timer)
  })
})
