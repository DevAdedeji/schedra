import { processSubscriptionSeatSyncJobs } from '../services/subscription-seat-sync'

const DRAIN_INTERVAL_MS = 10_000

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  let running = false
  const drain = async () => {
    if (running) return
    running = true
    try {
      await processSubscriptionSeatSyncJobs()
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'subscription_seat_sync_worker_failed',
        message: error instanceof Error ? error.message : String(error)
      }))
    } finally {
      running = false
    }
  }

  const timer = setInterval(drain, DRAIN_INTERVAL_MS)
  timer.unref()
  void drain()

  nitro.hooks.hook('close', () => clearInterval(timer))
})
