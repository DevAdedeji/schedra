import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { teamEventTemplateDefaultsSchema, type TeamEventTemplateDefaults } from '#shared/validation'
import { eventTypes, organizationEventTemplates } from '../database/schema'
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

export const MAX_ACTIVE_TEAM_EVENT_TEMPLATES = 50

interface CreateTeamEventTemplateInput {
  organizationId: string
  name: string
  defaults: TeamEventTemplateDefaults
  sourceEventTypeId: string
  createdByUserId: string
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

export async function createTeamEventTemplate(
  input: CreateTeamEventTemplateInput,
  executor: Database = useDatabase()
) {
  return executor.transaction(async (tx) => {
    // Count and insert must share an organization-scoped lock or two requests
    // can both observe slot 50 as free and exceed the product limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.organizationId}, 0))`)
    const [total] = await tx.select({ value: count() }).from(organizationEventTemplates).where(and(
      eq(organizationEventTemplates.organizationId, input.organizationId),
      isNull(organizationEventTemplates.archivedAt)
    ))
    if ((total?.value ?? 0) >= MAX_ACTIVE_TEAM_EVENT_TEMPLATES) {
      throw createError({ statusCode: 409, statusMessage: 'Archive an old template before creating another.' })
    }

    const [created] = await tx.insert(organizationEventTemplates).values(input)
      .returning({ id: organizationEventTemplates.id })
      .catch(rethrowTemplateNameConflict)
    if (!created) throw createError({ statusCode: 500, statusMessage: 'Could not create that template.' })
    return created
  })
}

function rethrowTemplateNameConflict(failure: unknown): never {
  if (String((failure as { message?: string })?.message ?? '').includes('organization_event_templates_active_name_key')) {
    throw createError({ statusCode: 409, statusMessage: 'An active template already uses that name.' })
  }
  throw failure
}
