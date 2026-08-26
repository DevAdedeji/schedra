import { and, asc, eq, isNull } from 'drizzle-orm'
import type { OrganizationRole } from '#shared/billing'
import { members, organizations } from '../database/schema'
import { useDatabase } from '../utils/database'
import { organizationEntitlement } from '../utils/entitlement'
import { requireAuthSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)

  // An archived workspace is gone as far as the switcher is concerned; its data
  // stays in the database for export and audit.
  const rows = await useDatabase()
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      logo: organizations.logo,
      role: members.role,
      joinedAt: members.createdAt
    })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(and(eq(members.userId, session.user.id), isNull(organizations.archivedAt)))
    .orderBy(asc(organizations.name))

  const items = await Promise.all(rows.map(async row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    role: row.role as OrganizationRole,
    joinedAt: row.joinedAt.toISOString(),
    entitlement: await organizationEntitlement(row.id)
  })))

  return { items }
})
