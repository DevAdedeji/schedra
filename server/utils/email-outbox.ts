import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import { emailOutbox } from '../database/schema'
import { useDatabase } from './database'
import { type Email, sendEmail } from './email'

interface OutboxEmail {
  dedupeKey: string
  email: Email
}

export type EmailInsertExecutor = Pick<Database, 'insert'>

export function emailDedupeKey(scope: string, value: string) {
  return `${scope}:${createHash('sha256').update(value).digest('hex')}`
}

export async function enqueueEmails(
  messages: OutboxEmail[],
  executor: EmailInsertExecutor = useDatabase()
) {
  if (!messages.length) return

  await executor
    .insert(emailOutbox)
    .values(messages.map(({ dedupeKey, email }) => ({
      dedupeKey,
      recipient: email.to,
      subject: email.subject,
      heading: email.heading,
      body: email.body,
      actionLabel: email.action.label,
      actionUrl: email.action.url,
      footer: email.footer
    })))
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
}

export async function processEmailOutbox(batchSize = 10) {
  const db = useDatabase()
  const now = new Date()
  const staleBefore = new Date(now.getTime() - 10 * 60_000)

  const jobs = await db.transaction(async (tx) => {
    await tx
      .update(emailOutbox)
      .set({ status: 'pending', lockedAt: null, availableAt: now, updatedAt: now })
      .where(and(eq(emailOutbox.status, 'sending'), lt(emailOutbox.lockedAt, staleBefore)))

    const pending = await tx
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, 'pending'), lte(emailOutbox.availableAt, now)))
      .orderBy(asc(emailOutbox.availableAt))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    if (!pending.length) return []

    return tx
      .update(emailOutbox)
      .set({ status: 'sending', lockedAt: now, attempts: sql`${emailOutbox.attempts} + 1`, updatedAt: now })
      .where(inArray(emailOutbox.id, pending.map(job => job.id)))
      .returning()
  })

  for (const job of jobs) {
    try {
      await sendEmail({
        to: job.recipient,
        subject: job.subject,
        heading: job.heading,
        body: job.body,
        action: { label: job.actionLabel, url: job.actionUrl },
        footer: job.footer ?? undefined
      }, job.id)

      await db
        .update(emailOutbox)
        .set({ status: 'sent', sentAt: new Date(), lockedAt: null, lastError: null, updatedAt: new Date() })
        .where(eq(emailOutbox.id, job.id))
    } catch (error) {
      const failed = job.attempts >= 8
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.max(0, job.attempts - 1))
      await db
        .update(emailOutbox)
        .set({
          status: failed ? 'failed' : 'pending',
          availableAt: new Date(Date.now() + delaySeconds * 1000),
          lockedAt: null,
          lastError: String(error instanceof Error ? error.message : error).slice(0, 1000),
          updatedAt: new Date()
        })
        .where(eq(emailOutbox.id, job.id))

      console.error(JSON.stringify({
        level: 'error',
        event: 'email_delivery_failed',
        jobId: job.id,
        attempt: job.attempts,
        terminal: failed
      }))
    }
  }

  return jobs.length
}
