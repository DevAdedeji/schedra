import { z } from 'zod'
import { recurringBookingRequestSchema } from './recurrence'
import { paymentCurrencySchema } from './payments'

export const RESERVED_USERNAMES = new Set([
  'admin', 'api', 'app', 'auth', 'billing', 'blog', 'dashboard', 'designs',
  'docs', 'help', 'integrations', 'invite', 'login', 'logout', 'me', 'new', 'pricing',
  'privacy', 'route', 'routing-forms', 'schedra', 'settings', 'signin', 'signup', 'support', 'team', 'terms',
  't', 'teams', 'w', 'workspaces', 'www'
])

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'At least 2 characters')
  .max(32, 'At most 32 characters')
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Letters, numbers and hyphens only, starting with a letter or number')
  .refine(value => !value.endsWith('-'), 'Cannot end with a hyphen')
  .refine(value => !value.includes('--'), 'Cannot contain two hyphens in a row')
  .refine(value => !RESERVED_USERNAMES.has(value), 'That one is reserved')

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(320, 'At most 320 characters')
  .pipe(z.email('That does not look like an email address'))
  .transform(value => value.toLowerCase())

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(80, 'At most 80 characters')

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200, 'At most 200 characters')

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(64, 'At most 64 characters')
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format()
      return true
    } catch {
      return false
    }
  }, 'That is not a valid time zone')

export const accountProfileSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  email: emailSchema,
  timeZone: timeZoneSchema.optional()
})

export const signUpSchema = accountProfileSchema.extend({
  password: passwordSchema
})

export const signUpFormSchema = signUpSchema.omit({ timeZone: true })

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Required')
})

export const requestResetSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string().min(1, 'Required')
  })
  .refine(values => values.password === values.confirm, {
    message: 'These do not match',
    path: ['confirm']
  })

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignUpFormInput = z.infer<typeof signUpFormSchema>
export type SignInInput = z.infer<typeof signInSchema>
export type RequestResetInput = z.infer<typeof requestResetSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const bookingSourceSchema = z.enum(['hosted', 'embed'])
export type BookingSource = z.infer<typeof bookingSourceSchema>

export const bookingAttributionSchema = z.object({
  referrerHost: z.string().trim().max(253).optional(),
  utmSource: z.string().trim().max(200).optional(),
  utmMedium: z.string().trim().max(200).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional()
}).optional()
export type BookingAttribution = z.infer<typeof bookingAttributionSchema>

export const createBookingSchema = z.object({
  username: z.string().min(1),
  slug: z.string().min(1),
  start: z.iso.datetime(),
  durationMinutes: z.number().int().min(5).max(720).optional(),
  requestId: z.uuid().optional(),
  recurrence: recurringBookingRequestSchema.optional(),
  name: z.string().trim().min(1, 'Please give a name').max(80),
  email: emailSchema,
  guestEmails: z.array(emailSchema).max(10, 'You can invite at most 10 additional guests.')
    .transform(values => [...new Set(values)]).optional(),
  timeZone: timeZoneSchema,
  notes: z.string().trim().max(2000).optional(),
  answers: z.record(
    z.string().trim().min(1).max(64),
    z.string().trim().max(2000)
  ).optional(),
  source: bookingSourceSchema.default('hosted'),
  attribution: bookingAttributionSchema,
  inviteToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).optional(),
  rescheduleOf: z.string().trim().max(64).optional()
}).superRefine((value, context) => {
  if (value.recurrence && !value.requestId) {
    context.addIssue({ code: 'custom', path: ['requestId'], message: 'A recurring booking needs a request identifier.' })
  }
  if (value.answers && Object.keys(value.answers).length > 10) {
    context.addIssue({
      code: 'custom',
      path: ['answers'],
      message: 'Too many booking answers were submitted.'
    })
  }
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>

export const createTeamBookingSchema = z.object({
  team: z.string().min(1),
  slug: z.string().min(1),
  start: z.iso.datetime(),
  durationMinutes: z.number().int().min(5).max(720).optional(),
  requestId: z.uuid().optional(),
  recurrence: recurringBookingRequestSchema.optional(),
  name: z.string().trim().min(1, 'Please give a name').max(80),
  email: emailSchema,
  guestEmails: z.array(emailSchema).max(10).transform(values => [...new Set(values)]).optional(),
  timeZone: timeZoneSchema,
  notes: z.string().trim().max(2000).optional(),
  answers: z.record(z.string().trim().min(1).max(64), z.string().trim().max(2000)).optional(),
  source: bookingSourceSchema.default('hosted'),
  attribution: bookingAttributionSchema,
  rescheduleOf: z.string().trim().max(64).optional()
}).superRefine((value, context) => {
  if (value.recurrence && !value.requestId) {
    context.addIssue({ code: 'custom', path: ['requestId'], message: 'A recurring booking needs a request identifier.' })
  }
})

export type CreateTeamBookingInput = z.infer<typeof createTeamBookingSchema>

export const updateProfileSchema = z.object({
  name: nameSchema,
  bio: z.string().trim().max(280, 'Keep it under 280 characters').optional(),
  timeZone: timeZoneSchema.optional()
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional()
})

export type CancelBookingInput = z.infer<typeof cancelBookingSchema>

export const bookingAttendanceStatusSchema = z.enum(['attended', 'no_show'])

export const updateBookingAttendanceSchema = z.object({
  status: bookingAttendanceStatusSchema.nullable()
})

export type BookingAttendanceStatus = z.infer<typeof bookingAttendanceStatusSchema>

export const rejectBookingSchema = z.object({
  reason: z.string().trim().max(500).optional()
})

export const deleteAccountSchema = z.object({
  email: emailSchema,
  confirmation: z.literal('DELETE')
})

const wallTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00')

export const availabilityRuleSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  start: wallTimeSchema,
  end: wallTimeSchema
}).refine(rule => rule.end > rule.start, {
  message: 'The end must come after the start',
  path: ['end']
})

export const dateOverrideSchema = z.object({
  date: z.iso.date(),
  start: wallTimeSchema.nullable(),
  end: wallTimeSchema.nullable()
}).refine(rule => (rule.start === null) === (rule.end === null), {
  message: 'Choose both a start and finish time, or mark the day unavailable.',
  path: ['end']
}).refine(rule => rule.start === null || rule.end! > rule.start, {
  message: 'The finish must come after the start.',
  path: ['end']
})

export const scheduleSchema = z.object({
  timeZone: timeZoneSchema,
  rules: z.array(availabilityRuleSchema).max(21),
  overrides: z.array(dateOverrideSchema).max(100).optional()
})

export const savedScheduleSchema = scheduleSchema.extend({
  name: z.string().trim().min(1, 'Give this schedule a name.').max(60, 'Keep the schedule name under 60 characters.'),
  isDefault: z.boolean().optional()
})

export type ScheduleInput = z.infer<typeof scheduleSchema>
export type AvailabilityRuleInput = z.infer<typeof availabilityRuleSchema>
export type DateOverrideInput = z.infer<typeof dateOverrideSchema>

export const eventTypeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Required')
  .max(64, 'At most 64 characters')
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Letters, numbers and hyphens only')
  .refine(value => !value.endsWith('-'), 'Cannot end with a hyphen')
  .refine(value => !value.includes('--'), 'Cannot contain two hyphens in a row')

export const meetingLocationTypeSchema = z.enum([
  'google_meet',
  'microsoft_teams',
  'zoom',
  'video_link',
  'phone',
  'in_person',
  'custom'
])

export type MeetingLocationType = z.infer<typeof meetingLocationTypeSchema>

export const bookingQuestionTypeSchema = z.enum(['short_text', 'long_text', 'select'])
export type BookingQuestionType = z.infer<typeof bookingQuestionTypeSchema>

export const bookingQuestionSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1, 'Give this question a label.').max(120, 'Keep question labels under 120 characters.'),
  type: bookingQuestionTypeSchema,
  required: z.boolean(),
  options: z.array(
    z.string().trim().min(1, 'Options cannot be empty.').max(80, 'Keep options under 80 characters.')
  ).max(20, 'A question can have at most 20 options.').default([])
}).superRefine((question, context) => {
  if (question.type !== 'select') {
    if (question.options.length) {
      context.addIssue({ code: 'custom', path: ['options'], message: 'Only choice questions can have options.' })
    }
    return
  }

  if (question.options.length < 2) {
    context.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two choices.' })
  }
  const normalized = question.options.map(option => option.toLocaleLowerCase())
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: 'custom', path: ['options'], message: 'Each choice must be different.' })
  }
})

export type BookingQuestion = z.infer<typeof bookingQuestionSchema>

export interface BookingAnswer {
  questionId: string
  label: string
  type: BookingQuestionType
  value: string
}

export interface BookingAnswersSnapshot {
  version: 1
  responses: BookingAnswer[]
  notes?: string
}

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const eventTypeBaseSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(100, 'At most 100 characters'),
  slug: eventTypeSlugSchema,
  description: z.string().trim().max(1000, 'At most 1000 characters').optional(),
  durationMinutes: z.number().int().min(5).max(720),
  additionalDurationMinutes: z.array(z.number().int().min(5).max(720)).max(4).default([]),
  recurringBookingEnabled: z.boolean().default(false),
  recurringBookingMaxOccurrences: z.number().int().min(2).max(8).default(8),
  incrementMinutes: z.number().int().min(5).max(720).nullable().optional(),
  bufferBeforeMinutes: z.number().int().min(0).max(1440),
  bufferAfterMinutes: z.number().int().min(0).max(1440),
  minimumNoticeMinutes: z.number().int().min(0).max(525_600),
  bookingWindowDays: z.number().int().min(1).max(3660).nullable().optional(),
  maxPerDay: z.number().int().min(1).max(100).nullable().optional(),
  maxPerWeek: z.number().int().min(1).max(700).nullable().optional(),
  maxPerMonth: z.number().int().min(1).max(3100).nullable().optional(),
  locationType: meetingLocationTypeSchema,
  locationDetails: z.string().trim().max(500, 'Keep meeting details under 500 characters.'),
  reminderMinutes: z.array(z.number().int().min(15).max(20_160)).max(5)
    .transform(values => [...new Set(values)].sort((a, b) => b - a)),
  bookingQuestions: z.array(bookingQuestionSchema).max(10, 'An event type can have at most 10 questions.').default([]),
  requiresConfirmation: z.boolean().default(false),
  capacity: z.number().int().min(1, 'Capacity must be at least 1.').max(500, 'Capacity cannot exceed 500.').default(1),
  paymentEnabled: z.boolean().default(false),
  priceCents: z.number().int().min(100, 'Price must be at least 1.00.').max(100_000_000).nullable().default(null),
  paymentCurrency: paymentCurrencySchema.default('USD'),
  scheduleId: z.uuid().optional(),
  hidden: z.boolean()
})

interface EventTypeShape {
  durationMinutes: number
  additionalDurationMinutes: number[]
  recurringBookingEnabled: boolean
  capacity: number
  bookingQuestions: BookingQuestion[]
  locationType: MeetingLocationType
  locationDetails: string
  paymentEnabled: boolean
  priceCents: number | null
  requiresConfirmation: boolean
}

/** Shared by personal and team event types, which differ only in who hosts. */
function refineEventType(value: EventTypeShape, context: z.RefinementCtx) {
  if (value.additionalDurationMinutes.includes(value.durationMinutes)) {
    context.addIssue({
      code: 'custom',
      path: ['additionalDurationMinutes'],
      message: 'The default duration is already included.'
    })
  }
  if (new Set(value.additionalDurationMinutes).size !== value.additionalDurationMinutes.length) {
    context.addIssue({
      code: 'custom',
      path: ['additionalDurationMinutes'],
      message: 'Each duration can only be offered once.'
    })
  }
  if (value.recurringBookingEnabled && (value.paymentEnabled || value.capacity > 1 || value.requiresConfirmation)) {
    context.addIssue({
      code: 'custom',
      path: ['recurringBookingEnabled'],
      message: 'Recurring bookings currently require a free, one-to-one event that confirms instantly.'
    })
  }
  if (value.paymentEnabled && value.priceCents === null) {
    context.addIssue({ code: 'custom', path: ['priceCents'], message: 'Add a price for this booking.' })
  }
  if (!value.paymentEnabled && value.priceCents !== null) {
    context.addIssue({ code: 'custom', path: ['priceCents'], message: 'Turn payments on before setting a price.' })
  }
  if (value.paymentEnabled && value.requiresConfirmation) {
    context.addIssue({
      code: 'custom',
      path: ['requiresConfirmation'],
      message: 'Paid bookings are confirmed after payment, so host approval cannot also be required.'
    })
  }
  const questionIds = value.bookingQuestions.map(question => question.id)
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['bookingQuestions'],
      message: 'Each booking question must have a unique identifier.'
    })
  }
  if (['google_meet', 'microsoft_teams', 'zoom'].includes(value.locationType)) return
  if (!value.locationDetails) {
    context.addIssue({
      code: 'custom',
      path: ['locationDetails'],
      message: 'Add the meeting link, address or instructions.'
    })
    return
  }
  if (value.locationType === 'video_link' && !isHttpUrl(value.locationDetails)) {
    context.addIssue({
      code: 'custom',
      path: ['locationDetails'],
      message: 'Enter a complete link beginning with https:// or http://.'
    })
  }
}

export const eventTypeSchema = eventTypeBaseSchema.superRefine(refineEventType)

export type EventTypeInput = z.infer<typeof eventTypeSchema>

export function eventTypeDurationOptions(eventType: {
  durationMinutes: number
  additionalDurationMinutes?: number[] | null
}) {
  return [eventType.durationMinutes, ...(eventType.additionalDurationMinutes ?? [])]
}

export const assignmentModeSchema = z.enum(['single', 'round_robin', 'collective'])
export type AssignmentMode = z.infer<typeof assignmentModeSchema>

export const teamEventTypeHostSchema = z.object({
  memberId: z.uuid(),
  // Null means the host's default schedule at booking time, so reorganising
  // their availability never quietly drops them out of rotation.
  scheduleId: z.uuid().nullable().default(null),
  enabled: z.boolean().default(true),
  weight: z.number().int().min(1).max(1000).default(100)
})

export type TeamEventTypeHostInput = z.infer<typeof teamEventTypeHostSchema>

// A team event borrows each host's own schedule, so there is no single
// scheduleId on the event itself.
export const teamEventTypeSchema = eventTypeBaseSchema
  .omit({ scheduleId: true })
  .extend({
    assignmentMode: assignmentModeSchema,
    hosts: z.array(teamEventTypeHostSchema).min(1, 'Choose at least one host.').max(50)
  })
  .superRefine((value, context) => {
    refineEventType(value, context)

    const memberIds = value.hosts.map(host => host.memberId)
    if (new Set(memberIds).size !== memberIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['hosts'],
        message: 'Each host can only be added once.'
      })
    }

    const active = value.hosts.filter(host => host.enabled)
    if (!active.length) {
      context.addIssue({
        code: 'custom',
        path: ['hosts'],
        message: 'At least one host must be active, or nobody can be booked.'
      })
      return
    }

    if (value.assignmentMode === 'single' && active.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['hosts'],
        message: 'A single-host event needs exactly one active host.'
      })
    }
  })

export type TeamEventTypeInput = z.infer<typeof teamEventTypeSchema>

/**
 * Template defaults never copy payment settings. They may be used once as a
 * starting point or synchronized to explicitly assigned member links.
 */
export const teamEventTemplateDefaultsSchema = eventTypeBaseSchema
  .omit({ slug: true, scheduleId: true, paymentEnabled: true, priceCents: true, paymentCurrency: true })
  .extend({ assignmentMode: assignmentModeSchema })
  .superRefine((value, context) => refineEventType({
    ...value,
    paymentEnabled: false,
    priceCents: null
  }, context))

export type TeamEventTemplateDefaults = z.infer<typeof teamEventTemplateDefaultsSchema>

export const managedEventMemberEditableFieldSchema = z.enum([
  'description',
  'locationDetails',
  'hidden'
])

export type ManagedEventMemberEditableField = z.infer<typeof managedEventMemberEditableFieldSchema>

export const teamEventTemplateWriteSchema = z.object({
  name: z.string().trim().min(1, 'Give this template a name.').max(80, 'Keep the template name under 80 characters.'),
  sourceEventTypeId: z.uuid('Choose an event type to copy defaults from.'),
  assignmentMemberIds: z.array(z.uuid()).max(50, 'A template can be assigned to at most 50 members.')
    .transform(values => [...new Set(values)]).default([]),
  memberEditableFields: z.array(managedEventMemberEditableFieldSchema)
    .transform(values => [...new Set(values)]).default([])
})

export type TeamEventTemplateWriteInput = z.infer<typeof teamEventTemplateWriteSchema>
