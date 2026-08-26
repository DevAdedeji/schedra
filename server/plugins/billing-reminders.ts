import { expireLapsedTeams, processBillingReminders } from '../services/billing-reminders'

// Billing deadlines move in days, so this sweeps hourly rather than on the
// seconds cadence the outbox and calendar workers use.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await processBillingReminders()
      await expireLapsedTeams()
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'billing_reminder_worker_failed',
        message: error instanceof Error ? error.message : String(error)
      }))
    } finally {
      running = false
    }
  }

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  timer.unref()
  void sweep()

  nitro.hooks.hook('close', () => clearInterval(timer))
})
