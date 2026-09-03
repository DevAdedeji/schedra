import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  teamEventTemplateDefaultsSchema,
  type ManagedEventMemberEditableField,
  type TeamEventTemplateDefaults
} from '#shared/validation'
import {
  eventTypeHosts,
  eventTypes,
  members,
  organizationEventTemplateAssignments,
  organizationEventTemplates,
  users
} from '../database/schema'
import { useDatabase } from '../database'
import type { Database } from '../database/client'
import { requireTeamLocationIntegrations } from './event-location'

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
  maxPerWeek: eventTypes.maxPerWeek,
  maxPerMonth: eventTypes.maxPerMonth,
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
  assignmentMemberIds?: string[]
  memberEditableFields?: ManagedEventMemberEditableField[]
}

interface UpdateTeamEventTemplateInput extends CreateTeamEventTemplateInput {
  id: string
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
  const assignmentMemberIds = input.assignmentMemberIds ?? []
  const memberEditableFields = input.memberEditableFields ?? []
  const assignedMembers = await assignedMemberRecords(input.organizationId, assignmentMemberIds, executor)
  await requireTeamLocationIntegrations(assignedMembers.map(member => member.userId), input.defaults.locationType)

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

    const [created] = await tx.insert(organizationEventTemplates).values({
      organizationId: input.organizationId,
      name: input.name,
      defaults: input.defaults,
      sourceEventTypeId: input.sourceEventTypeId,
      createdByUserId: input.createdByUserId,
      memberEditableFields
    })
      .returning({ id: organizationEventTemplates.id })
      .catch(rethrowTemplateNameConflict)
    if (!created) throw createError({ statusCode: 500, statusMessage: 'Could not create that template.' })
    const changes = await syncTemplateAssignments({
      organizationId: input.organizationId,
      templateId: created.id,
      defaults: input.defaults,
      memberEditableFields,
      assignedMembers,
      createdByUserId: input.createdByUserId
    }, tx)
    return { ...created, ...changes }
  })
}

export async function updateTeamEventTemplate(
  input: UpdateTeamEventTemplateInput,
  executor: Database = useDatabase()
) {
  const assignmentMemberIds = input.assignmentMemberIds ?? []
  const memberEditableFields = input.memberEditableFields ?? []
  const assignedMembers = await assignedMemberRecords(input.organizationId, assignmentMemberIds, executor)
  await requireTeamLocationIntegrations(assignedMembers.map(member => member.userId), input.defaults.locationType)

  return executor.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.organizationId}, 0))`)
    const [updated] = await tx.update(organizationEventTemplates).set({
      name: input.name,
      defaults: input.defaults,
      sourceEventTypeId: input.sourceEventTypeId,
      memberEditableFields,
      updatedAt: sql`now()`
    }).where(and(
      eq(organizationEventTemplates.id, input.id),
      eq(organizationEventTemplates.organizationId, input.organizationId),
      isNull(organizationEventTemplates.archivedAt)
    )).returning({ id: organizationEventTemplates.id }).catch(rethrowTemplateNameConflict)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Template not found.' })

    const changes = await syncTemplateAssignments({
      organizationId: input.organizationId,
      templateId: input.id,
      defaults: input.defaults,
      memberEditableFields,
      assignedMembers,
      createdByUserId: input.createdByUserId
    }, tx)
    return { ...updated, ...changes }
  })
}

type AssignedMember = Awaited<ReturnType<typeof assignedMemberRecords>>[number]

async function assignedMemberRecords(
  organizationId: string,
  memberIds: string[],
  executor: Database
) {
  if (!memberIds.length) return []
  const rows = await executor.select({
    id: members.id,
    userId: members.userId,
    username: users.username
  }).from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.organizationId, organizationId), inArray(members.id, memberIds)))

  if (rows.length !== memberIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'One of the selected members is no longer in this team.' })
  }
  const byId = new Map(rows.map(row => [row.id, row]))
  return memberIds.map(id => byId.get(id)!)
}

function managedEventValues(defaults: TeamEventTemplateDefaults) {
  return {
    title: defaults.title,
    description: defaults.description ?? null,
    durationMinutes: defaults.durationMinutes,
    additionalDurationMinutes: defaults.additionalDurationMinutes,
    recurringBookingEnabled: defaults.recurringBookingEnabled,
    recurringBookingMaxOccurrences: defaults.recurringBookingMaxOccurrences,
    incrementMinutes: defaults.incrementMinutes ?? null,
    bufferBeforeMinutes: defaults.bufferBeforeMinutes,
    bufferAfterMinutes: defaults.bufferAfterMinutes,
    minimumNoticeMinutes: defaults.minimumNoticeMinutes,
    bookingWindowDays: defaults.bookingWindowDays ?? null,
    maxPerDay: defaults.maxPerDay ?? null,
    maxPerWeek: defaults.maxPerWeek ?? null,
    maxPerMonth: defaults.maxPerMonth ?? null,
    locationType: defaults.locationType,
    locationDetails: defaults.locationDetails,
    reminderMinutes: defaults.reminderMinutes,
    bookingQuestions: defaults.bookingQuestions,
    requiresConfirmation: defaults.requiresConfirmation,
    capacity: defaults.capacity,
    hidden: defaults.hidden,
    assignmentMode: 'single' as const,
    paymentEnabled: false,
    priceCents: null,
    paymentCurrency: 'USD' as const,
    scheduleId: null
  }
}

function managedFieldsForUpdate(
  defaults: TeamEventTemplateDefaults,
  editableFields: ManagedEventMemberEditableField[]
) {
  const fields = managedEventValues(defaults)
  const editable = new Set<string>(editableFields)
  return Object.fromEntries(Object.entries(fields).filter(([field]) => !editable.has(field)))
}

function managedSlug(title: string, username: string, used: Set<string>) {
  const clean = `${title}-${username}`.toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'managed-event'
  const base = clean.slice(0, 64).replace(/-$/, '')
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    const tail = `-${suffix++}`
    candidate = `${base.slice(0, 64 - tail.length).replace(/-$/, '')}${tail}`
  }
  used.add(candidate)
  return candidate
}

async function syncTemplateAssignments(input: {
  organizationId: string
  templateId: string
  defaults: TeamEventTemplateDefaults
  memberEditableFields: ManagedEventMemberEditableField[]
  assignedMembers: AssignedMember[]
  createdByUserId: string
}, tx: Pick<Database, 'select' | 'insert' | 'update' | 'delete'>) {
  const existing = await tx.select({
    id: organizationEventTemplateAssignments.id,
    memberId: organizationEventTemplateAssignments.memberId,
    eventTypeId: organizationEventTemplateAssignments.eventTypeId
  }).from(organizationEventTemplateAssignments)
    .where(and(
      eq(organizationEventTemplateAssignments.organizationId, input.organizationId),
      eq(organizationEventTemplateAssignments.templateId, input.templateId)
    ))

  const selected = new Set(input.assignedMembers.map(member => member.id))
  const existingByMember = new Map(existing.map(assignment => [assignment.memberId, assignment]))
  const retained = existing.filter(assignment => selected.has(assignment.memberId))
  const detached = existing.filter(assignment => !selected.has(assignment.memberId))
  const added = input.assignedMembers.filter(member => !existingByMember.has(member.id))

  if (retained.length) {
    await tx.update(eventTypes).set({
      ...managedFieldsForUpdate(input.defaults, input.memberEditableFields),
      updatedAt: sql`now()`
    }).where(and(
      eq(eventTypes.organizationId, input.organizationId),
      inArray(eventTypes.id, retained.map(assignment => assignment.eventTypeId))
    ))
  }

  if (detached.length) {
    await tx.delete(organizationEventTemplateAssignments)
      .where(inArray(organizationEventTemplateAssignments.id, detached.map(assignment => assignment.id)))
  }

  if (added.length) {
    const usedRows = await tx.select({ slug: eventTypes.slug }).from(eventTypes)
      .where(eq(eventTypes.organizationId, input.organizationId))
    const used = new Set(usedRows.map(row => row.slug))
    const created: Array<{ id: string, member: AssignedMember, slug: string }> = []
    for (const member of added) {
      let inserted: { id: string } | undefined
      let id = ''
      let slug = ''
      for (let attempt = 0; attempt < 100 && !inserted; attempt += 1) {
        id = crypto.randomUUID()
        slug = managedSlug(input.defaults.title, member.username, used)
        // Another request can claim a slug after our initial read. Ignoring only
        // the uniqueness conflict lets us choose the next safe suffix in-place.
        const rows = await tx.insert(eventTypes).values({
          id,
          ...managedEventValues(input.defaults),
          slug,
          organizationId: input.organizationId,
          userId: null,
          createdByUserId: input.createdByUserId
        }).onConflictDoNothing().returning({ id: eventTypes.id })
        inserted = rows[0]
      }
      if (!inserted) {
        throw createError({ statusCode: 409, statusMessage: 'A unique managed booking link could not be created. Please try again.' })
      }
      created.push({ id, member, slug })
    }

    await tx.insert(eventTypeHosts).values(created.map(({ id, member }) => ({
      eventTypeId: id,
      memberId: member.id,
      userId: member.userId,
      scheduleId: null,
      enabled: true,
      position: 0,
      weight: 100
    })))
    await tx.insert(organizationEventTemplateAssignments).values(created.map(({ id, member }) => ({
      organizationId: input.organizationId,
      templateId: input.templateId,
      memberId: member.id,
      eventTypeId: id
    })))
  }

  return {
    createdAssignments: added.length,
    updatedAssignments: retained.length,
    detachedAssignments: detached.length
  }
}

export async function managedEventAssignmentForUser(
  organizationId: string,
  eventTypeId: string,
  userId: string,
  executor: Database = useDatabase()
) {
  const [assignment] = await executor.select({
    templateId: organizationEventTemplateAssignments.templateId,
    memberId: organizationEventTemplateAssignments.memberId,
    memberEditableFields: organizationEventTemplates.memberEditableFields
  }).from(organizationEventTemplateAssignments)
    .innerJoin(organizationEventTemplates, eq(organizationEventTemplates.id, organizationEventTemplateAssignments.templateId))
    .innerJoin(members, eq(members.id, organizationEventTemplateAssignments.memberId))
    .where(and(
      eq(organizationEventTemplateAssignments.organizationId, organizationId),
      eq(organizationEventTemplateAssignments.eventTypeId, eventTypeId),
      eq(members.userId, userId),
      isNull(organizationEventTemplates.archivedAt)
    )).limit(1)
  return assignment ?? null
}

export async function managedEventAssignment(
  organizationId: string,
  eventTypeId: string,
  executor: Database = useDatabase()
) {
  const [assignment] = await executor.select({
    templateId: organizationEventTemplateAssignments.templateId,
    memberId: organizationEventTemplateAssignments.memberId,
    assignedUserId: members.userId,
    memberEditableFields: organizationEventTemplates.memberEditableFields
  }).from(organizationEventTemplateAssignments)
    .innerJoin(organizationEventTemplates, eq(organizationEventTemplates.id, organizationEventTemplateAssignments.templateId))
    .innerJoin(members, eq(members.id, organizationEventTemplateAssignments.memberId))
    .where(and(
      eq(organizationEventTemplateAssignments.organizationId, organizationId),
      eq(organizationEventTemplateAssignments.eventTypeId, eventTypeId),
      isNull(organizationEventTemplates.archivedAt)
    )).limit(1)
  return assignment ?? null
}

function rethrowTemplateNameConflict(failure: unknown): never {
  if (String((failure as { message?: string })?.message ?? '').includes('organization_event_templates_active_name_key')) {
    throw createError({ statusCode: 409, statusMessage: 'An active template already uses that name.' })
  }
  throw failure
}
