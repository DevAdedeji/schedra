import { processEmailOutbox } from '../services/email-outbox'
import { logEvent } from '../observability/logger'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  let running = false
  const drain = async () => {
    if (running) return
    running = true
    try {
      await processEmailOutbox()
    } catch (error) {
      logEvent('error', 'email_outbox_worker_failed', { error })
    } finally {
      running = false
    }
  }

  const timer = setInterval(drain, 10_000)
  timer.unref()
  void drain()

  nitro.hooks.hook('close', () => clearInterval(timer))
})
