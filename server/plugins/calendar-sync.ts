import { processCalendarSyncJobs } from '../services/calendar-sync'
import { logEvent } from '../observability/logger'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  let running = false
  const drain = async () => {
    if (running) return
    running = true
    try {
      await processCalendarSyncJobs()
    } catch (error) {
      logEvent('error', 'calendar_sync_worker_failed', { error })
    } finally {
      running = false
    }
  }

  const timer = setInterval(drain, 10_000)
  timer.unref()
  void drain()

  nitro.hooks.hook('close', () => clearInterval(timer))
})
