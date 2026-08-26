import { count, desc, eq } from 'drizzle-orm'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import { organizationAuditLogs, users } from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { requireOrganizationPermission } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { member: ['update'] })

  const parsed = await getValidatedQuery(event, paginationQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid activity log filters.' })

  const { page, pageSize } = parsed.data
  const db = useDatabase()
  const where = eq(organizationAuditLogs.organizationId, context.organization.id)

  const [[totalRow], items] = await Promise.all([
    db.select({ value: count() }).from(organizationAuditLogs).where(where),
    db.select({
      id: organizationAuditLogs.id,
      action: organizationAuditLogs.action,
      targetType: organizationAuditLogs.targetType,
      targetId: organizationAuditLogs.targetId,
      metadata: organizationAuditLogs.metadata,
      createdAt: organizationAuditLogs.createdAt,
      actorName: users.name,
      // Falls back to the recorded address when the actor's account is gone.
      actorEmail: organizationAuditLogs.actorEmail
    }).from(organizationAuditLogs)
      .leftJoin(users, eq(users.id, organizationAuditLogs.actorUserId))
      .where(where)
      .orderBy(desc(organizationAuditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  return {
    items: items.map(item => ({ ...item, createdAt: item.createdAt.toISOString() })),
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize)
  }
})
