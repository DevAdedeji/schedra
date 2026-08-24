import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import { bookings, emailOutbox } from '../database/schema'
import { useDatabase } from './database'
import { type Email, sendEmail } from './email'

interface OutboxEmail {
  dedupeKey: string
  email: Email
  bookingUid?: string
  category?: 'transactional' | 'booking_reminder'
  availableAt?: Date
}

export type EmailInsertExecutor = Pick<Database, 'insert'>
export type EmailUpdateExecutor = Pick<Database, 'update'>

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
    .values(messages.map(({ dedupeKey, email, bookingUid, category, availableAt }) => ({
      dedupeKey,
      recipient: email.to,
      subject: email.subject,
      preheader: email.preheader,
      heading: email.heading,
      body: email.body,
      details: email.details,
      actionLabel: email.action.label,
      actionUrl: email.action.url,
      footer: email.footer,
      bookingUid,
      category: category ?? 'transactional',
      availableAt
    })))
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
}

export async function cancelBookingReminders(
  bookingUid: string,
  executor: EmailUpdateExecutor = useDatabase()
) {
  await executor.update(emailOutbox).set({
    status: 'cancelled',
    lockedAt: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(emailOutbox.bookingUid, bookingUid),
    eq(emailOutbox.category, 'booking_reminder'),
    eq(emailOutbox.status, 'pending')
  ))
}

export async function processEmailOutbox(batchSize = 10) {
  const db = useDatabase()

  const jobs = await db.transaction(async (tx) => {
    await tx
      .update(emailOutbox)
      .set({ status: 'pending', lockedAt: null, availableAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(emailOutbox.status, 'sending'), lt(emailOutbox.lockedAt, sql`now() - interval '10 minutes'`)))

    const pending = await tx
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, 'pending'), lte(emailOutbox.availableAt, sql`now()`)))
      .orderBy(asc(emailOutbox.availableAt))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    if (!pending.length) return []

    return tx
      .update(emailOutbox)
      .set({ status: 'sending', lockedAt: sql`now()`, attempts: sql`${emailOutbox.attempts} + 1`, updatedAt: sql`now()` })
      .where(inArray(emailOutbox.id, pending.map(job => job.id)))
      .returning()
  })

  for (const job of jobs) {
    try {
      if (job.category === 'booking_reminder' && job.bookingUid) {
        const [booking] = await db.select({
          status: bookings.status,
          endsAt: bookings.endsAt
        }).from(bookings).where(eq(bookings.uid, job.bookingUid)).limit(1)

        if (!booking || !['pending', 'confirmed'].includes(booking.status) || booking.endsAt <= new Date()) {
          await db.update(emailOutbox).set({
            status: 'cancelled',
            lockedAt: null,
            updatedAt: sql`now()`
          }).where(eq(emailOutbox.id, job.id))
          continue
        }
      }

      await sendEmail({
        to: job.recipient,
        subject: job.subject,
        preheader: job.preheader ?? undefined,
        heading: job.heading,
        body: job.body,
        details: job.details ?? undefined,
        action: { label: job.actionLabel, url: job.actionUrl },
        footer: job.footer ?? undefined
      }, job.id)

      await db
        .update(emailOutbox)
        .set({ status: 'sent', sentAt: sql`now()`, lockedAt: null, lastError: null, updatedAt: sql`now()` })
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
          updatedAt: sql`now()`
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
