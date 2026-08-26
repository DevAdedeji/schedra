import type { H3Event } from 'h3'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { OrganizationRole } from '#shared/billing'
import { organizationAccessRoles } from '#shared/organization-access'
import type { organizationStatements } from '#shared/organization-access'
import {
  members,
  organizationAuditLogs,
  organizationSlugHistory,
  organizations
} from '../database/schema'
import { useDatabase } from './database'
import { organizationEntitlement } from './entitlement'
import { requireAuthSession } from './session'

type PermissionRequest = Partial<{
  [K in keyof typeof organizationStatements]: Array<(typeof organizationStatements)[K][number]>
}>

export interface OrganizationContext {
  organization: {
    id: string
    name: string
    slug: string
    logo: string | null
    archivedAt: Date | null
  }
  role: OrganizationRole
  userId: string
  userEmail: string
}

export async function findOrganizationBySlug(slug: string) {
  const db = useDatabase()
  const [organization] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      logo: organizations.logo,
      archivedAt: organizations.archivedAt
    })
    .from(organizations)
    .where(sql`lower(${organizations.slug}) = ${slug.toLowerCase()}`)
    .limit(1)

  if (organization) return { organization, renamed: false as const }

  // A renamed workspace keeps its old public links working.
  const [previous] = await db
    .select({ organizationId: organizationSlugHistory.organizationId })
    .from(organizationSlugHistory)
    .where(sql`lower(${organizationSlugHistory.slug}) = ${slug.toLowerCase()}`)
    .limit(1)

  if (!previous) return null

  const [current] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      logo: organizations.logo,
      archivedAt: organizations.archivedAt
    })
    .from(organizations)
    .where(eq(organizations.id, previous.organizationId))
    .limit(1)

  return current ? { organization: current, renamed: true as const } : null
}

export async function membershipFor(organizationId: string, userId: string) {
  const [membership] = await useDatabase()
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)))
    .limit(1)

  return membership ? { id: membership.id, role: membership.role as OrganizationRole } : null
}

export async function requireOrganization(
  event: H3Event,
  slug: string,
  options: { allowArchived?: boolean } = {}
): Promise<OrganizationContext> {
  const session = await requireAuthSession(event)
  const found = await findOrganizationBySlug(slug)

  // Membership is never confirmed or denied for a workspace the caller cannot
  // see, so a stranger cannot probe which slugs exist.
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

  const membership = await membershipFor(found.organization.id, session.user.id)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

  if (found.organization.archivedAt && !options.allowArchived) {
    throw createError({ statusCode: 410, statusMessage: 'This workspace has been archived.' })
  }

  return {
    organization: found.organization,
    role: membership.role,
    userId: session.user.id,
    userEmail: session.user.email
  }
}

export function assertPermission(role: OrganizationRole, request: PermissionRequest) {
  const result = organizationAccessRoles[role].authorize(request as never)
  if (!result.success) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to do that in this workspace.'
    })
  }
}

export async function requireOrganizationPermission(
  event: H3Event,
  slug: string,
  request: PermissionRequest,
  options: { allowArchived?: boolean } = {}
) {
  const context = await requireOrganization(event, slug, options)
  assertPermission(context.role, request)
  return context
}

/**
 * Deleting an account cascades its memberships away, which would leave any
 * workspace it owns without an owner. Callers must clear this first.
 */
export async function activeWorkspacesOwnedBy(userId: string) {
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

export async function countMembersWithRole(organizationId: string, role: OrganizationRole) {
  const [row] = await useDatabase()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.role, role)))

  return row?.value ?? 0
}

export async function organizationContextPayload(context: OrganizationContext) {
  const entitlement = await organizationEntitlement(context.organization.id)
  return {
    organization: {
      id: context.organization.id,
      name: context.organization.name,
      slug: context.organization.slug,
      logo: context.organization.logo,
      archived: Boolean(context.organization.archivedAt)
    },
    role: context.role,
    entitlement
  }
}

export interface AuditEntry {
  organizationId: string
  action: string
  actorUserId?: string | null
  actorEmail?: string | null
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Audit writes must never fail the action they describe — a lost log line is
 * better than a half-applied membership change.
 */
export async function recordAudit(entry: AuditEntry) {
  try {
    await useDatabase().insert(organizationAuditLogs).values({
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null
    })
  } catch (error) {
    console.error('failed to record organization audit entry', entry.action, error)
  }
}
