import { and, count, desc, eq, ilike } from 'drizzle-orm'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import type { InvitableRole } from '#shared/billing'
import { invitations, users } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { requireOrganizationPermission } from '../../../utils/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  // Pending invitations expose the email addresses of people who have not
  // joined, so only those who can manage invitations may read them.
  const context = await requireOrganizationPermission(event, slug, { invitation: ['create'] })

  const parsed = await getValidatedQuery(event, paginationQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid invitation filters.' })

  const { page, pageSize, search } = parsed.data
  const db = useDatabase()
  const pending = and(
    eq(invitations.organizationId, context.organization.id),
    eq(invitations.status, 'pending')
  )
  const where = search ? and(pending, ilike(invitations.email, `%${search}%`)) : pending

  const [[totalRow], items] = await Promise.all([
    db.select({ value: count() }).from(invitations).where(where),
    db.select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      inviterName: users.name,
      inviterEmail: users.email
    }).from(invitations)
      .innerJoin(users, eq(users.id, invitations.inviterId))
      .where(where)
      .orderBy(desc(invitations.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  const now = new Date()

  return {
    items: items.map(item => ({
      ...item,
      role: item.role as InvitableRole,
      expiresAt: item.expiresAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
      expired: item.expiresAt < now
    })),
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize)
  }
})
