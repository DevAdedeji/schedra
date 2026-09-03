import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { EmailNotificationPreferences, OptionalHostEmailCategory } from '#shared/email-notification-preferences'
import { DEFAULT_EMAIL_NOTIFICATION_PREFERENCES } from '#shared/email-notification-preferences'
import type { Database } from '../database/client'
import { useDatabase } from '../database'
import { emailNotificationPreferences, users } from '../database/schema'

export interface OptionalHostRecipient {
  userId?: string
  email: string
}

export type NotificationPreferenceExecutor = Pick<Database, 'insert' | 'select'>

export async function emailPreferencesForUser(userId: string): Promise<EmailNotificationPreferences> {
  const [stored] = await useDatabase().select({
    newBookingEmails: emailNotificationPreferences.newBookingEmails,
    rescheduleEmails: emailNotificationPreferences.rescheduleEmails,
    cancellationEmails: emailNotificationPreferences.cancellationEmails,
    approvalRequestEmails: emailNotificationPreferences.approvalRequestEmails
  }).from(emailNotificationPreferences)
    .where(eq(emailNotificationPreferences.userId, userId))
    .limit(1)
  return stored ?? { ...DEFAULT_EMAIL_NOTIFICATION_PREFERENCES }
}

export async function saveEmailPreferences(
  userId: string,
  input: EmailNotificationPreferences
): Promise<EmailNotificationPreferences> {
  const [stored] = await useDatabase().insert(emailNotificationPreferences).values({
    userId,
    ...input
  }).onConflictDoUpdate({
    target: emailNotificationPreferences.userId,
    set: { ...input, updatedAt: sql`now()` }
  }).returning({
    newBookingEmails: emailNotificationPreferences.newBookingEmails,
    rescheduleEmails: emailNotificationPreferences.rescheduleEmails,
    cancellationEmails: emailNotificationPreferences.cancellationEmails,
    approvalRequestEmails: emailNotificationPreferences.approvalRequestEmails
  })
  if (!stored) throw new Error('Notification preferences were not saved.')
  return stored
}

export async function optionalHostRecipients<T extends OptionalHostRecipient>(
  recipients: readonly T[],
  category: OptionalHostEmailCategory,
  executor: NotificationPreferenceExecutor = useDatabase()
): Promise<T[]> {
  if (!recipients.length) return []
  const userIds = recipients.flatMap(recipient => recipient.userId ? [recipient.userId] : [])
  const emails = recipients.map(recipient => recipient.email.toLowerCase())
  const stored = await executor.select({
    userId: emailNotificationPreferences.userId,
    email: users.email,
    enabled: emailNotificationPreferences[category]
  }).from(emailNotificationPreferences)
    .innerJoin(users, eq(users.id, emailNotificationPreferences.userId))
    .where(and(
      eq(emailNotificationPreferences[category], false),
      or(
        userIds.length ? inArray(emailNotificationPreferences.userId, userIds) : undefined,
        inArray(sql`lower(${users.email})`, emails)
      )
    ))
  const disabledUserIds = new Set(stored.map(row => row.userId))
  const disabledEmails = new Set(stored.map(row => row.email.toLowerCase()))
  return recipients.filter(recipient => (
    (!recipient.userId || !disabledUserIds.has(recipient.userId))
    && !disabledEmails.has(recipient.email.toLowerCase())
  ))
}
