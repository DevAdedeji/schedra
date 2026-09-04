import { z } from 'zod'

export const bookingEmailTemplateKeys = [
  'confirmation',
  'reminder',
  'reschedule',
  'request',
  'rejection',
  'cancellation'
] as const

export type BookingEmailTemplateKey = typeof bookingEmailTemplateKeys[number]

export const bookingEmailTemplateOptions: Array<{
  value: BookingEmailTemplateKey
  label: string
  description: string
}> = [
  { value: 'confirmation', label: 'Booking confirmed', description: 'Sent after a booking is confirmed.' },
  { value: 'reminder', label: 'Booking reminder', description: 'Sent before a confirmed booking starts.' },
  { value: 'reschedule', label: 'Booking rescheduled', description: 'Sent when a booking moves to another time.' },
  { value: 'request', label: 'Booking request', description: 'Sent while a booking waits for your approval.' },
  { value: 'rejection', label: 'Request declined', description: 'Sent when a booking request is declined.' },
  { value: 'cancellation', label: 'Booking cancelled', description: 'Sent when a booking is cancelled.' }
]

export const bookingEmailVariables = [
  { token: '{{guest_name}}', label: 'Guest name' },
  { token: '{{event_name}}', label: 'Event name' },
  { token: '{{host_name}}', label: 'Host name' },
  { token: '{{start_time}}', label: 'Date and time' },
  { token: '{{time_zone}}', label: 'Guest timezone' }
] as const

export interface BookingEmailTemplate {
  subject: string
  body: string
}

export type BookingEmailTemplates = Record<BookingEmailTemplateKey, BookingEmailTemplate | null>

export interface BookingEmailTemplateSettings {
  templates: BookingEmailTemplates
  footer: string | null
}

export const DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS: BookingEmailTemplateSettings = {
  templates: {
    confirmation: null,
    reminder: null,
    reschedule: null,
    request: null,
    rejection: null,
    cancellation: null
  },
  footer: null
}

export const bookingEmailTemplateSamples: Record<BookingEmailTemplateKey, BookingEmailTemplate> = {
  confirmation: {
    subject: 'Confirmed: {{event_name}} with {{host_name}}',
    body: 'Hi {{guest_name}}, your meeting with {{host_name}} is confirmed for {{start_time}}.'
  },
  reminder: {
    subject: 'Reminder: {{event_name}} with {{host_name}}',
    body: 'Hi {{guest_name}}, this is a reminder about your upcoming meeting at {{start_time}}.'
  },
  reschedule: {
    subject: 'Rescheduled: {{event_name}} with {{host_name}}',
    body: 'Hi {{guest_name}}, your meeting has moved to {{start_time}}.'
  },
  request: {
    subject: 'Request sent: {{event_name}} with {{host_name}}',
    body: 'Hi {{guest_name}}, your request for {{start_time}} is waiting for the host’s approval.'
  },
  rejection: {
    subject: 'Booking request declined: {{event_name}}',
    body: 'Hi {{guest_name}}, the requested time for {{event_name}} could not be confirmed.'
  },
  cancellation: {
    subject: 'Cancelled: {{event_name}} with {{host_name}}',
    body: 'Hi {{guest_name}}, your meeting scheduled for {{start_time}} has been cancelled.'
  }
}

const allowedTokens = new Set<string>(bookingEmailVariables.map(variable => variable.token))

function onlyKnownVariables(value: string) {
  const pattern = /{{\s*([^{}]+?)\s*}}/g
  const variables = [...value.matchAll(pattern)]
  const remainder = value.replace(pattern, '')
  return !remainder.includes('{{')
    && !remainder.includes('}}')
    && variables.every(match => allowedTokens.has(match[0] ?? ''))
}

const templateText = (maximum: number, label: string) => z.string()
  .trim()
  .min(1, `${label} cannot be empty.`)
  .max(maximum, `${label} must be ${maximum} characters or fewer.`)
  .refine(onlyKnownVariables, 'Use only the supported variables shown below the editor.')

export const bookingEmailTemplateSchema = z.object({
  subject: templateText(140, 'Subject'),
  body: templateText(1200, 'Message')
}).strict()

const templatesShape = Object.fromEntries(
  bookingEmailTemplateKeys.map(key => [key, bookingEmailTemplateSchema.nullable()])
) as Record<BookingEmailTemplateKey, z.ZodNullable<typeof bookingEmailTemplateSchema>>

export const bookingEmailTemplateSettingsSchema = z.object({
  templates: z.object(templatesShape).strict(),
  footer: z.string()
    .trim()
    .max(240, 'Footer must be 240 characters or fewer.')
    .nullable()
    .transform(value => value || null)
}).strict()

export function readBookingEmailTemplateSettings(value: unknown): BookingEmailTemplateSettings {
  const parsed = bookingEmailTemplateSettingsSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : structuredClone(DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS)
}

export function renderBookingEmailTemplate(
  template: BookingEmailTemplate,
  variables: Record<(typeof bookingEmailVariables)[number]['token'], string>
) {
  const render = (value: string) => Object.entries(variables)
    .reduce((result, [token, replacement]) => result.replaceAll(token, replacement), value)

  return {
    subject: render(template.subject),
    body: render(template.body)
  }
}
