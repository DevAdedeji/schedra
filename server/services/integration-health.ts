import { and, eq, inArray, sql } from 'drizzle-orm'
import { bookingHosts, calendarSyncJobs } from '../database/schema'
import { useDatabase } from '../database'
import type { IntegrationProviderId } from '../integrations/errors'

export interface IntegrationSyncHealth {
  pending: number
  processing: number
  failed: number
  lastError: string | null
  failureProvider: IntegrationProviderId | null
  retryableProviderCounts: Partial<Record<IntegrationProviderId, number>>
}

export async function integrationSyncHealth(userId: string): Promise<IntegrationSyncHealth> {
  const jobs = await useDatabase().select({
    status: calendarSyncJobs.status,
    lastError: calendarSyncJobs.lastError,
    failureProvider: calendarSyncJobs.failureProvider,
    updatedAt: calendarSyncJobs.updatedAt
  }).from(calendarSyncJobs)
    .innerJoin(bookingHosts, and(
      eq(bookingHosts.bookingId, calendarSyncJobs.bookingId),
      eq(bookingHosts.userId, userId)
    ))
    .where(inArray(calendarSyncJobs.status, ['pending', 'processing', 'failed']))
    .orderBy(sql`${calendarSyncJobs.updatedAt} desc`)

  const providerCounts: Partial<Record<IntegrationProviderId, number>> = {}
  for (const job of jobs) {
    if (job.status !== 'failed') continue
    const provider = job.failureProvider as IntegrationProviderId | null
    if (provider && ['google', 'microsoft', 'zoom'].includes(provider)) {
      providerCounts[provider] = (providerCounts[provider] ?? 0) + 1
    }
  }
  const latestFailure = jobs.find(job => job.status === 'failed' && job.lastError)

  return {
    pending: jobs.filter(job => job.status === 'pending').length,
    processing: jobs.filter(job => job.status === 'processing').length,
    failed: jobs.filter(job => job.status === 'failed').length,
    lastError: latestFailure?.lastError ?? null,
    failureProvider: (latestFailure?.failureProvider as IntegrationProviderId | null) ?? null,
    retryableProviderCounts: providerCounts
  }
}

export async function retryFailedIntegrationSyncs(
  userId: string,
  provider?: IntegrationProviderId
) {
  const bookingIds = useDatabase().select({ bookingId: bookingHosts.bookingId })
    .from(bookingHosts)
    .where(eq(bookingHosts.userId, userId))

  const providerFilter = provider ? eq(calendarSyncJobs.failureProvider, provider) : undefined

  const retried = await useDatabase().update(calendarSyncJobs).set({
    revision: sql`${calendarSyncJobs.revision} + 1`,
    status: 'pending',
    attempts: 0,
    availableAt: sql`now()`,
    lockedAt: null,
    completedAt: null,
    lastError: null,
    failureProvider: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(calendarSyncJobs.status, 'failed'),
    inArray(calendarSyncJobs.bookingId, bookingIds),
    providerFilter
  )).returning({ id: calendarSyncJobs.id })

  return retried.length
}
