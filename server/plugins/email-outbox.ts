import { processEmailOutbox } from '../utils/email-outbox'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  let running = false
  const drain = async () => {
    if (running) return
    running = true
    try {
      await processEmailOutbox()
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'email_outbox_worker_failed',
        message: error instanceof Error ? error.message : String(error)
      }))
    } finally {
      running = false
    }
  }

  const timer = setInterval(drain, 10_000)
  timer.unref()
  void drain()

  nitro.hooks.hook('close', () => clearInterval(timer))
})
