import { z } from 'zod'
import { emailSchema } from './validation'

export const workflowTriggerSchema = z.enum([
  'booking_created',
  'booking_requested',
  'booking_approved',
  'booking_rejected',
  'booking_cancelled',
  'booking_rescheduled',
  'booking_no_show',
  'before_start',
  'after_end'
])

export const workflowIdSchema = z.uuid()

export const workflowEmailRecipientSchema = z.enum(['attendee', 'hosts', 'custom'])

export const workflowEmailActionSchema = z.object({
  type: z.literal('email'),
  recipient: workflowEmailRecipientSchema,
  customRecipient: emailSchema.optional(),
  subject: z.string().trim().min(1, 'Give the email a subject.').max(160),
  body: z.string().trim().min(1, 'Write the email message.').max(5000)
}).superRefine((value, context) => {
  if (value.recipient === 'custom' && !value.customRecipient) {
    context.addIssue({ code: 'custom', path: ['customRecipient'], message: 'Enter the recipient email address.' })
  }
})

export const workflowWebhookActionSchema = z.object({
  type: z.literal('webhook'),
  url: z.url('Enter a complete HTTPS URL.').max(2000)
    .refine(value => new URL(value).protocol === 'https:', 'Webhook URLs must use HTTPS.')
})

export const workflowActionSchema = z.discriminatedUnion('type', [
  workflowEmailActionSchema,
  workflowWebhookActionSchema
])

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1, 'Give this workflow a name.').max(80),
  trigger: workflowTriggerSchema,
  offsetMinutes: z.number().int().min(0).max(10_080).default(0),
  eventTypeId: z.uuid().nullable().default(null),
  action: workflowActionSchema,
  active: z.boolean().default(true)
}).superRefine((value, context) => {
  if (value.trigger === 'before_start' && value.offsetMinutes < 5) {
    context.addIssue({ code: 'custom', path: ['offsetMinutes'], message: 'Send it at least 5 minutes before the meeting.' })
  }
  if (!['before_start', 'after_end'].includes(value.trigger) && value.offsetMinutes !== 0) {
    context.addIssue({ code: 'custom', path: ['offsetMinutes'], message: 'This trigger does not use a time offset.' })
  }
})

export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>
export type WorkflowEmailRecipient = z.infer<typeof workflowEmailRecipientSchema>
export type WorkflowEmailAction = z.infer<typeof workflowEmailActionSchema>
export type WorkflowWebhookAction = z.infer<typeof workflowWebhookActionSchema>
export type WorkflowAction = z.infer<typeof workflowActionSchema>
export type WorkflowInput = z.infer<typeof workflowInputSchema>

export const bookingDomainEventTypes = [
  'booking_created',
  'booking_requested',
  'booking_approved',
  'booking_rejected',
  'booking_cancelled',
  'booking_rescheduled',
  'booking_no_show'
] as const

export type BookingDomainEventType = typeof bookingDomainEventTypes[number]
