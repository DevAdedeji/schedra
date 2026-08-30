import { and, eq } from 'drizzle-orm'
import { teamEventTemplateDefaultsSchema, type TeamEventTemplateDefaults } from '#shared/validation'
import { eventTypes } from '../database/schema'
import { useDatabase } from '../database'
import type { Database } from '../database/client'

const templateSelection = {
  title: eventTypes.title,
  description: eventTypes.description,
  durationMinutes: eventTypes.durationMinutes,
  additionalDurationMinutes: eventTypes.additionalDurationMinutes,
  recurringBookingEnabled: eventTypes.recurringBookingEnabled,
  recurringBookingMaxOccurrences: eventTypes.recurringBookingMaxOccurrences,
  incrementMinutes: eventTypes.incrementMinutes,
  bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
  bufferAfterMinutes: eventTypes.bufferAfterMinutes,
  minimumNoticeMinutes: eventTypes.minimumNoticeMinutes,
  bookingWindowDays: eventTypes.bookingWindowDays,
  maxPerDay: eventTypes.maxPerDay,
  locationType: eventTypes.locationType,
  locationDetails: eventTypes.locationDetails,
  reminderMinutes: eventTypes.reminderMinutes,
  bookingQuestions: eventTypes.bookingQuestions,
  requiresConfirmation: eventTypes.requiresConfirmation,
  capacity: eventTypes.capacity,
  hidden: eventTypes.hidden,
  assignmentMode: eventTypes.assignmentMode
}

export async function snapshotTeamEventDefaults(
  organizationId: string,
  eventTypeId: string,
  executor: Database = useDatabase()
) {
  const [row] = await executor.select(templateSelection).from(eventTypes).where(and(
    eq(eventTypes.id, eventTypeId),
    eq(eventTypes.organizationId, organizationId)
  )).limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Choose an event type from this team.' })

  const parsed = teamEventTemplateDefaultsSchema.safeParse({
    ...row,
    description: row.description ?? undefined
  })
  if (!parsed.success) {
    throw createError({ statusCode: 409, statusMessage: 'That event type has settings that cannot be saved as a template.' })
  }
  return parsed.data
}

export function validStoredTemplateDefaults(defaults: unknown): TeamEventTemplateDefaults | null {
  const parsed = teamEventTemplateDefaultsSchema.safeParse(defaults)
  return parsed.success ? parsed.data : null
}
