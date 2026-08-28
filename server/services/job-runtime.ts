import { randomUUID } from 'node:crypto'
import { processCalendarSyncJobs } from './calendar-sync'
import { processEmailOutbox } from './email-outbox'
import { processSubscriptionSeatSyncJobs } from './subscription-seat-sync'
import { expireLapsedTeams, processBillingReminders } from './billing-reminders'
import { evaluateOperationsAlerts } from './operations-alerts'
import { dispatchDomainEvents, processAutomationRuns } from './workflows'
import {
  heartbeatWorkerInstance,
  pruneWorkerInstances,
  registerWorkerInstance,
  stopWorkerInstance,
  withWorkerLease
} from './worker-coordination'
import { logEvent } from '../observability/logger'

export interface RuntimeTask {
  name: string
  intervalMs: number
  initialDelayMs?: number
  leaseMs?: number
  run: () => Promise<unknown>
}

export function defaultRuntimeTasks(): RuntimeTask[] {
  return [
    {
      name: 'calendar-sync',
      intervalMs: 5_000,
      leaseMs: 60_000,
      run: () => processCalendarSyncJobs()
    },
    {
      name: 'email-outbox',
      intervalMs: 5_000,
      leaseMs: 60_000,
      run: () => processEmailOutbox()
    },
    {
      name: 'workflow-automation',
      intervalMs: 5_000,
      leaseMs: 60_000,
      run: async () => {
        const dispatched = await dispatchDomainEvents()
        const delivered = await processAutomationRuns()
        return { dispatched, delivered }
      }
    },
    {
      name: 'subscription-seat-sync',
      intervalMs: 5_000,
      leaseMs: 60_000,
      run: () => processSubscriptionSeatSyncJobs()
    },
    {
      name: 'operations-alerts',
      intervalMs: 60_000,
      initialDelayMs: 15_000,
      leaseMs: 120_000,
      run: () => evaluateOperationsAlerts()
    },
    {
      name: 'billing-maintenance',
      intervalMs: 60 * 60 * 1000,
      leaseMs: 10 * 60_000,
      run: async () => {
        const reminders = await processBillingReminders()
        const expired = await expireLapsedTeams()
        await pruneWorkerInstances()
        return { reminders, expired }
      }
    }
  ]
}

export function createJobRuntime(input: {
  role: 'worker' | 'all'
  workerId?: string
  tasks?: RuntimeTask[]
  heartbeatMs?: number
  shutdownTimeoutMs?: number
}) {
  const workerId = input.workerId ?? randomUUID()
  const tasks = input.tasks ?? defaultRuntimeTasks()
  const heartbeatMs = input.heartbeatMs ?? 15_000
  const shutdownTimeoutMs = input.shutdownTimeoutMs ?? 25_000
  const timers = new Set<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>()
  const inFlight = new Map<string, Promise<void>>()
  let started = false
  let stopping = false

  const runTask = (task: RuntimeTask) => {
    if (stopping || inFlight.has(task.name)) return inFlight.get(task.name)

    const promise = (async () => {
      const startedAt = performance.now()
      try {
        const execution = await withWorkerLease({
          name: `runtime:${task.name}`,
          ownerId: workerId,
          ttlMs: task.leaseMs,
          task: task.run
        })
        if (!execution.acquired) return

        const count = processedCount(execution.result)
        if (count > 0) {
          logEvent('info', 'worker_task_completed', {
            workerId,
            task: task.name,
            processed: count,
            durationMs: Math.round((performance.now() - startedAt) * 10) / 10
          })
        }
      } catch (error) {
        logEvent('error', 'worker_task_failed', {
          workerId,
          task: task.name,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          error
        })
      }
    })().finally(() => inFlight.delete(task.name))

    inFlight.set(task.name, promise)
    return promise
  }

  async function start() {
    if (started) return
    started = true
    await registerWorkerInstance(workerId, input.role)

    const heartbeat = setInterval(() => {
      void heartbeatWorkerInstance(workerId)
        .then(async (alive) => {
          // Test resets and manual maintenance can remove the row while the
          // process is healthy. Re-register instead of reporting a false outage.
          if (!alive) await registerWorkerInstance(workerId, input.role)
        })
        .catch(error => logEvent('error', 'worker_heartbeat_failed', {
          workerId,
          error
        }))
    }, heartbeatMs)
    heartbeat.unref()
    timers.add(heartbeat)

    for (const task of tasks) {
      const schedule = () => {
        if (stopping) return
        void runTask(task)
        const timer = setInterval(() => {
          void runTask(task)
        }, task.intervalMs)
        timer.unref()
        timers.add(timer)
      }

      if ((task.initialDelayMs ?? 0) > 0) {
        const timer = setTimeout(schedule, task.initialDelayMs)
        timer.unref()
        timers.add(timer)
      } else {
        schedule()
      }
    }

    logEvent('info', 'worker_runtime_started', {
      workerId,
      role: input.role,
      tasks: tasks.map(task => task.name)
    })
  }

  async function stop() {
    if (!started || stopping) return
    stopping = true
    for (const timer of timers) clearInterval(timer)
    timers.clear()

    const draining = Promise.allSettled([...inFlight.values()])
    let timedOut = false
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      draining,
      new Promise<void>((resolve) => {
        shutdownTimer = setTimeout(() => {
          timedOut = true
          resolve()
        }, shutdownTimeoutMs)
        shutdownTimer.unref()
      })
    ])
    if (shutdownTimer) clearTimeout(shutdownTimer)

    // A timed-out task may still be executing in this process. Keep its lease
    // alive until it finishes (or this process dies and the lease expires) so a
    // replacement worker cannot overlap the same schedule prematurely.
    await stopWorkerInstance(workerId, !timedOut)
    logEvent(timedOut ? 'warn' : 'info', 'worker_runtime_stopped', {
      workerId,
      graceful: !timedOut,
      unfinishedTasks: timedOut ? [...inFlight.keys()] : []
    })
  }

  return {
    workerId,
    start,
    stop,
    runTask,
    get runningTasks() { return [...inFlight.keys()] }
  }
}

function processedCount(result: unknown) {
  if (typeof result === 'number') return result
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>
    if (typeof record.sent === 'number') return record.sent
    return Object.values(record).reduce<number>((total, value) => (
      total + (typeof value === 'number' ? value : 0)
    ), 0)
  }
  return 0
}
