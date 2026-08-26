import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { InvitableRole } from '#shared/billing'
import { invitations, organizations, users } from '../../database/schema'
import { useDatabase } from '../../utils/database'
import { organizationEntitlement } from '../../utils/entitlement'
import { enforceRateLimit } from '../../utils/rate-limit'

export type InvitationState
  = | 'pending'
    | 'accepted'
    | 'rejected'
    | 'canceled'
    | 'expired'
    | 'archived'
    | 'workspace_full'

/**
 * Unauthenticated on purpose: someone with no Schedra account has to see which
 * workspace invited them before deciding to sign up. The invitation id is
 * opaque and only reaches the invited mailbox.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'invitation-preview', limit: 30, windowSeconds: 60 })

  const id = getRouterParam(event, 'id') ?? ''
  if (!z.uuid().safeParse(id).success) {
    throw createError({ statusCode: 404, statusMessage: 'That invitation link is not valid.' })
  }

  const [invitation] = await useDatabase()
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      organizationArchivedAt: organizations.archivedAt,
      inviterName: users.name
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .innerJoin(users, eq(users.id, invitations.inviterId))
    .where(eq(invitations.id, id))
    .limit(1)

  if (!invitation) {
    throw createError({ statusCode: 404, statusMessage: 'That invitation link is not valid.' })
  }

  const state = await resolveState(invitation)

  return {
    state,
    email: invitation.email,
    role: invitation.role as InvitableRole,
    expiresAt: invitation.expiresAt.toISOString(),
    organization: {
      name: invitation.organizationName,
      slug: invitation.organizationSlug
    },
    inviterName: invitation.inviterName
  }
})

async function resolveState(invitation: {
  status: string
  expiresAt: Date
  organizationId: string
  organizationArchivedAt: Date | null
}): Promise<InvitationState> {
  if (invitation.status !== 'pending') return invitation.status as InvitationState
  if (invitation.organizationArchivedAt) return 'archived'
  if (invitation.expiresAt < new Date()) return 'expired'

  // Surfaced before sign-up rather than after, so nobody creates an account
  // only to be turned away at the last step.
  const entitlement = await organizationEntitlement(invitation.organizationId)
  if (!entitlement.canAddMembers) return 'workspace_full'

  return 'pending'
}
