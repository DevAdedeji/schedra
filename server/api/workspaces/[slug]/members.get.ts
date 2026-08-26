import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import type { OrganizationRole } from '#shared/billing'
import { members, users } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { requireOrganization } from '../../../utils/organization'

const querySchema = paginationQuerySchema.extend({
  filter: z.enum(['all', 'owner', 'admin', 'member']).default('all')
})

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganization(event, slug)

  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid member filters.' })

  const { page, pageSize, search, filter } = parsed.data
  const db = useDatabase()
  const inWorkspace = eq(members.organizationId, context.organization.id)
  const byRole = filter === 'all' ? undefined : eq(members.role, filter)
  const matchesSearch = search
    ? or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`), ilike(users.username, `%${search}%`))
    : undefined
  const where = and(inWorkspace, byRole, matchesSearch)

  const [[totalRow], [countRow], items] = await Promise.all([
    db.select({ value: count() }).from(members).innerJoin(users, eq(users.id, members.userId)).where(where),
    db.select({
      all: count(),
      owner: sql<number>`count(*) filter (where ${members.role} = 'owner')`.mapWith(Number),
      admin: sql<number>`count(*) filter (where ${members.role} = 'admin')`.mapWith(Number),
      member: sql<number>`count(*) filter (where ${members.role} = 'member')`.mapWith(Number)
    }).from(members).where(inWorkspace),
    db.select({
      id: members.id,
      userId: members.userId,
      role: members.role,
      joinedAt: members.createdAt,
      name: users.name,
      email: users.email,
      username: users.username,
      avatarUrl: users.avatarUrl,
      timeZone: users.timeZone
    }).from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(where)
      // Owners first, then admins, so the people who can act are at the top.
      .orderBy(sql`case ${members.role} when 'owner' then 0 when 'admin' then 1 else 2 end`, asc(users.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  return {
    items: items.map(item => ({
      ...item,
      role: item.role as OrganizationRole,
      joinedAt: item.joinedAt.toISOString(),
      isYou: item.userId === context.userId
    })),
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize),
    counts: {
      all: countRow?.all ?? 0,
      owner: countRow?.owner ?? 0,
      admin: countRow?.admin ?? 0,
      member: countRow?.member ?? 0
    }
  }
})
