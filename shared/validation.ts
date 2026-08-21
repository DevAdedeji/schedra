import { z } from 'zod'

export const RESERVED_USERNAMES = new Set([
  'admin', 'api', 'app', 'auth', 'billing', 'blog', 'dashboard', 'designs',
  'docs', 'help', 'login', 'logout', 'me', 'new', 'pricing', 'privacy',
  'schedra', 'settings', 'signin', 'signup', 'support', 'team', 'terms', 'www'
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

export const createBookingSchema = z.object({
  username: z.string().min(1),
  slug: z.string().min(1),
  start: z.iso.datetime(),
  name: z.string().trim().min(1, 'Please give a name').max(80),
  email: emailSchema,
  timeZone: z.string().trim().min(1).max(64),
  notes: z.string().trim().max(2000).optional()
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>

export const updateProfileSchema = z.object({
  name: nameSchema,
  bio: z.string().trim().max(280, 'Keep it under 280 characters').optional(),
  timeZone: z.string().trim().min(1).max(64).optional()
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
