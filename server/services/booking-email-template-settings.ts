import { eq, sql } from 'drizzle-orm'
import {
  readBookingEmailTemplateSettings,
  type BookingEmailTemplateSettings
} from '#shared/email-templates'
import { organizations, users } from '../database/schema'
import { useDatabase } from '../database'

export async function personalBookingEmailTemplateSettings(userId: string) {
  const [row] = await useDatabase().select({ value: users.bookingEmailTemplates })
    .from(users).where(eq(users.id, userId)).limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Your profile could not be found.' })
  return readBookingEmailTemplateSettings(row.value)
}

export async function teamBookingEmailTemplateSettings(organizationId: string) {
  const [row] = await useDatabase().select({ value: organizations.bookingEmailTemplates })
    .from(organizations).where(eq(organizations.id, organizationId)).limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Team not found.' })
  return readBookingEmailTemplateSettings(row.value)
}

export async function savePersonalBookingEmailTemplateSettings(
  userId: string,
  settings: BookingEmailTemplateSettings
) {
  const [row] = await useDatabase().update(users).set({
    bookingEmailTemplates: settings,
    updatedAt: sql`now()`
  }).where(eq(users.id, userId)).returning({ value: users.bookingEmailTemplates })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Your profile could not be found.' })
  return readBookingEmailTemplateSettings(row.value)
}

export async function saveTeamBookingEmailTemplateSettings(
  organizationId: string,
  settings: BookingEmailTemplateSettings
) {
  const [row] = await useDatabase().update(organizations).set({
    bookingEmailTemplates: settings,
    updatedAt: sql`now()`
  }).where(eq(organizations.id, organizationId)).returning({ value: organizations.bookingEmailTemplates })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Team not found.' })
  return readBookingEmailTemplateSettings(row.value)
}
