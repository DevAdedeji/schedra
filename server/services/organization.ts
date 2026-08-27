import type { H3Event } from 'h3'
import type { OrganizationRole } from '#shared/billing'
import { organizationAccessRoles } from '#shared/organization-access'
import type { organizationStatements } from '#shared/organization-access'
import {
  activeOrganizationsOwnedBy,
  insertOrganizationAudit,
  memberCountByRole,
  membershipByOrganizationAndUser,
  organizationByCurrentSlug,
  organizationByHistoricalSlug
} from '../repositories/organization'
import { organizationEntitlement } from './entitlement'
import { requireAuthSession } from './session'
import { logEvent } from '../observability/logger'

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
  const organization = await organizationByCurrentSlug(slug)

  if (organization) return { organization, renamed: false as const }

  // A renamed team keeps its old public links working.
  const current = await organizationByHistoricalSlug(slug)

  return current ? { organization: current, renamed: true as const } : null
}

export async function membershipFor(organizationId: string, userId: string) {
  const membership = await membershipByOrganizationAndUser(organizationId, userId)

  return membership ? { id: membership.id, role: membership.role as OrganizationRole } : null
}

export async function requireOrganization(
  event: H3Event,
  slug: string,
  options: { allowArchived?: boolean } = {}
): Promise<OrganizationContext> {
  const session = await requireAuthSession(event)
  const found = await findOrganizationBySlug(slug)

  // Membership is never confirmed or denied for a team the caller cannot
  // see, so a stranger cannot probe which slugs exist.
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Team not found' })

  const membership = await membershipFor(found.organization.id, session.user.id)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Team not found' })

  if (found.organization.archivedAt && !options.allowArchived) {
    throw createError({ statusCode: 410, statusMessage: 'This team has been archived.' })
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
      statusMessage: 'You do not have permission to do that in this team.'
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
 * team it owns without an owner. Callers must clear this first.
 */
export async function activeTeamsOwnedBy(userId: string) {
  return activeOrganizationsOwnedBy(userId)
}

export async function countMembersWithRole(organizationId: string, role: OrganizationRole) {
  return memberCountByRole(organizationId, role)
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
    await insertOrganizationAudit({
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null
    })
  } catch (error) {
    logEvent('error', 'organization_audit_write_failed', { action: entry.action, error })
  }
}
