import { z } from 'zod'

export const DEFAULT_EMAIL_NOTIFICATION_PREFERENCES = {
  newBookingEmails: true,
  rescheduleEmails: true,
  cancellationEmails: true,
  approvalRequestEmails: true
} as const

export const emailNotificationPreferencesSchema = z.object({
  newBookingEmails: z.boolean(),
  rescheduleEmails: z.boolean(),
  cancellationEmails: z.boolean(),
  approvalRequestEmails: z.boolean()
}).strict()

export type EmailNotificationPreferences = z.infer<typeof emailNotificationPreferencesSchema>
export type OptionalHostEmailCategory = keyof EmailNotificationPreferences
