import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import {
  eventTypeHosts,
  eventTypes,
  members,
  organizationEventTemplateAssignments,
  organizationEventTemplates,
  users
} from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { requireOrganization } from '../../../services/organization'

const querySchema = paginationQuerySchema.extend({
  filter: z.enum(['all', 'active', 'hidden']).default('all')
})

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganization(event, slug)

  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid event type filters.' })

  const { page, pageSize, search, filter } = parsed.data
  const db = useDatabase()
  const owned = eq(eventTypes.organizationId, context.organization.id)
  const visibility = filter === 'active'
    ? eq(eventTypes.hidden, false)
    : filter === 'hidden'
      ? eq(eventTypes.hidden, true)
      : undefined
  const matchesSearch = search
    ? or(ilike(eventTypes.title, `%${search}%`), ilike(eventTypes.slug, `%${search}%`))
    : undefined
  const where = and(owned, visibility, matchesSearch)

  const [[totalRow], [countRow], items] = await Promise.all([
    db.select({ value: count() }).from(eventTypes).where(where),
    db.select({
      all: count(),
      active: sql<number>`count(*) filter (where ${eventTypes.hidden} = false)`.mapWith(Number),
      hidden: sql<number>`count(*) filter (where ${eventTypes.hidden} = true)`.mapWith(Number)
    }).from(eventTypes).where(owned),
    db.select({
      id: eventTypes.id,
      slug: eventTypes.slug,
      title: eventTypes.title,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      additionalDurationMinutes: eventTypes.additionalDurationMinutes,
      recurringBookingEnabled: eventTypes.recurringBookingEnabled,
      recurringBookingMaxOccurrences: eventTypes.recurringBookingMaxOccurrences,
      maxPerDay: eventTypes.maxPerDay,
      maxPerWeek: eventTypes.maxPerWeek,
      maxPerMonth: eventTypes.maxPerMonth,
      assignmentMode: eventTypes.assignmentMode,
      locationType: eventTypes.locationType,
      requiresConfirmation: eventTypes.requiresConfirmation,
      capacity: eventTypes.capacity,
      paymentEnabled: eventTypes.paymentEnabled,
      priceCents: eventTypes.priceCents,
      paymentCurrency: eventTypes.paymentCurrency,
      hidden: eventTypes.hidden,
      createdAt: eventTypes.createdAt
    }).from(eventTypes)
      .where(where)
      .orderBy(asc(eventTypes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  // Hosts drive whether an event is bookable at all, so the list carries them
  // rather than making the page fetch each event separately.
  const [hosts, managed] = items.length
    ? await Promise.all([db.select({
        eventTypeId: eventTypeHosts.eventTypeId,
        memberId: eventTypeHosts.memberId,
        enabled: eventTypeHosts.enabled,
        name: users.name,
        avatarUrl: users.avatarUrl
      }).from(eventTypeHosts)
        .innerJoin(users, eq(users.id, eventTypeHosts.userId))
        .where(inArray(eventTypeHosts.eventTypeId, items.map(item => item.id))),
      db.select({
        eventTypeId: organizationEventTemplateAssignments.eventTypeId,
        templateId: organizationEventTemplateAssignments.templateId,
        templateName: organizationEventTemplates.name,
        assignedUserId: members.userId,
        memberEditableFields: organizationEventTemplates.memberEditableFields
      }).from(organizationEventTemplateAssignments)
        .innerJoin(organizationEventTemplates, eq(organizationEventTemplates.id, organizationEventTemplateAssignments.templateId))
        .innerJoin(members, eq(members.id, organizationEventTemplateAssignments.memberId))
        .where(and(
          eq(organizationEventTemplateAssignments.organizationId, context.organization.id),
          inArray(organizationEventTemplateAssignments.eventTypeId, items.map(item => item.id))
        ))])
    : [[], []]

  return {
    items: items.map((item) => {
      const management = managed.find(entry => entry.eventTypeId === item.id)
      return {
        ...item,
        managed: management
          ? {
              ...management,
              canPersonalize: Boolean(management.memberEditableFields.length
                && (management.assignedUserId === context.userId || context.role !== 'member'))
            }
          : null,
        createdAt: item.createdAt.toISOString(),
        hosts: hosts.filter(host => host.eventTypeId === item.id)
      }
    }),
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize),
    counts: {
      all: countRow?.all ?? 0,
      active: countRow?.active ?? 0,
      hidden: countRow?.hidden ?? 0
    }
  }
})
