import { z } from 'zod'

export const RESERVED_USERNAMES = new Set([
  'admin', 'api', 'app', 'auth', 'billing', 'blog', 'dashboard', 'designs',
  'docs', 'help', 'integrations', 'invite', 'login', 'logout', 'me', 'new', 'pricing',
  'privacy', 'schedra', 'settings', 'signin', 'signup', 'support', 'team', 'terms',
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
  rescheduleOf: z.string().trim().max(64).optional()
}).superRefine((value, context) => {
  if (value.answers && Object.keys(value.answers).length > 10) {
    context.addIssue({
      code: 'custom',
      path: ['answers'],
      message: 'Too many booking answers were submitted.'
    })
  }
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>

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
  incrementMinutes: z.number().int().min(5).max(720).nullable().optional(),
  bufferBeforeMinutes: z.number().int().min(0).max(1440),
  bufferAfterMinutes: z.number().int().min(0).max(1440),
  minimumNoticeMinutes: z.number().int().min(0).max(525_600),
  bookingWindowDays: z.number().int().min(1).max(730).nullable().optional(),
  maxPerDay: z.number().int().min(1).max(100).nullable().optional(),
  locationType: meetingLocationTypeSchema,
  locationDetails: z.string().trim().max(500, 'Keep meeting details under 500 characters.'),
  reminderMinutes: z.array(z.number().int().min(15).max(20_160)).max(5)
    .transform(values => [...new Set(values)].sort((a, b) => b - a)),
  bookingQuestions: z.array(bookingQuestionSchema).max(10, 'An event type can have at most 10 questions.').default([]),
  requiresConfirmation: z.boolean().default(false),
  scheduleId: z.uuid().optional(),
  hidden: z.boolean()
})

interface EventTypeShape {
  bookingQuestions: BookingQuestion[]
  locationType: MeetingLocationType
  locationDetails: string
}

/** Shared by personal and team event types, which differ only in who hosts. */
function refineEventType(value: EventTypeShape, context: z.RefinementCtx) {
  const questionIds = value.bookingQuestions.map(question => question.id)
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['bookingQuestions'],
      message: 'Each booking question must have a unique identifier.'
    })
  }
  if (['google_meet', 'zoom'].includes(value.locationType)) return
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
