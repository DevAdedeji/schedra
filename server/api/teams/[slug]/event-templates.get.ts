import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { eventTypes, organizationEventTemplates } from '../../../database/schema'
import { useDatabase } from '../../../database'
import { requireOrganization } from '../../../services/organization'
import { validStoredTemplateDefaults } from '../../../services/team-event-template'

export default defineEventHandler(async (event) => {
  const context = await requireOrganization(event, getRouterParam(event, 'slug') ?? '')
  const filter = getQuery(event).filter === 'archived' ? 'archived' : 'active'
  const where = and(
    eq(organizationEventTemplates.organizationId, context.organization.id),
    filter === 'archived'
      ? isNotNull(organizationEventTemplates.archivedAt)
      : isNull(organizationEventTemplates.archivedAt)
  )
  const db = useDatabase()
  const [rows, sourceEventTypes] = await Promise.all([
    db.select().from(organizationEventTemplates)
      .where(where)
      .orderBy(filter === 'archived' ? desc(organizationEventTemplates.archivedAt) : asc(organizationEventTemplates.name)),
    db.select({
      id: eventTypes.id,
      title: eventTypes.title,
      durationMinutes: eventTypes.durationMinutes
    }).from(eventTypes)
      .where(eq(eventTypes.organizationId, context.organization.id))
      .orderBy(asc(eventTypes.title))
  ])

  return {
    items: rows.flatMap((row) => {
      const defaults = validStoredTemplateDefaults(row.defaults)
      return defaults
        ? [{
            id: row.id,
            name: row.name,
            defaults,
            sourceEventTypeId: row.sourceEventTypeId,
            archivedAt: row.archivedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString()
          }]
        : []
    }),
    sourceEventTypes
  }
})
