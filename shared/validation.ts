import { z } from 'zod'

/**
 * One definition used by both the form and the server. The browser copy gives
 * fast inline errors; the server copy is the one that actually decides, because
 * `required` attributes are trivially skipped by posting to the endpoint.
 */

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

export const signUpSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  timeZone: z.string().trim().min(1).max(64).optional()
})

export type SignUpInput = z.infer<typeof signUpSchema>

/** First error message per field, shaped for a form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {}

  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '')
    if (key && !result[key]) result[key] = issue.message
  }

  return result
}
