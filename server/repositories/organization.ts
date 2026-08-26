import { and, eq, isNull, sql } from 'drizzle-orm'
import type { OrganizationRole } from '#shared/billing'
import {
  members,
  organizationAuditLogs,
  organizationSlugHistory,
  organizations
} from '../database/schema'
import { useDatabase } from '../database/index'

const selection = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  logo: organizations.logo,
  archivedAt: organizations.archivedAt
}

export async function organizationByCurrentSlug(slug: string) {
  const [organization] = await useDatabase()
    .select(selection)
    .from(organizations)
    .where(sql`lower(${organizations.slug}) = ${slug.toLowerCase()}`)
    .limit(1)
  return organization ?? null
}

export async function organizationByHistoricalSlug(slug: string) {
  const [row] = await useDatabase()
    .select(selection)
    .from(organizationSlugHistory)
    .innerJoin(organizations, eq(organizations.id, organizationSlugHistory.organizationId))
    .where(sql`lower(${organizationSlugHistory.slug}) = ${slug.toLowerCase()}`)
    .limit(1)
  return row ?? null
}

export async function membershipByOrganizationAndUser(organizationId: string, userId: string) {
  const [membership] = await useDatabase()
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)))
    .limit(1)
  return membership ?? null
}

export function activeOrganizationsOwnedBy(userId: string) {
  return useDatabase()
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(and(
      eq(members.userId, userId),
      eq(members.role, 'owner'),
      isNull(organizations.archivedAt)
    ))
}

export async function memberCountByRole(organizationId: string, role: OrganizationRole) {
  const [row] = await useDatabase()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.role, role)))
  return row?.value ?? 0
}

export async function insertOrganizationAudit(entry: {
  organizationId: string
  action: string
  actorUserId: string | null
  actorEmail: string | null
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
}) {
  await useDatabase().insert(organizationAuditLogs).values(entry)
}
