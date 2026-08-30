import { sql } from 'drizzle-orm'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins/organization'
import { accountProfileSchema } from '../../shared/validation'
import { TEAM_PLAN, createOrganizationSchema } from '../../shared/billing'
import { accessControl, organizationAccessRoles } from '../../shared/organization-access'
import * as schema from '../database/schema'
import { useDatabase } from '../database'
import { createStarterSetup } from './onboarding'
import { emailDedupeKey, enqueueEmails } from './email-outbox'
import { queueVerificationEmail } from './verification-email'
import { useEnv } from '../config/env'
import { assertCanAddMember, organizationEntitlement, startTrial } from './entitlement'
import { countMembersWithRole, recordAudit } from './organization'
import { enqueueSubscriptionSeatSync } from './subscription-seat-sync'

function createAuth() {
  const env = useEnv()

  return betterAuth({
    baseURL: env.schedraUrl,
    secret: env.authSecret,
    trustedOrigins: [env.schedraUrl],

    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100
    },

    database: drizzleAdapter(useDatabase(), {
      provider: 'pg',
      schema,
      usePlural: true
    }),

    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 }
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 200,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await enqueueEmails([{
          dedupeKey: emailDedupeKey('password-reset', url),
          email: {
            to: user.email,
            subject: 'Reset your Schedra password',
            preheader: 'Use this secure link to choose a new Schedra password.',
            heading: 'Reset your password',
            body: 'We received a request to reset your Schedra password. Use the secure button below to choose a new one.\n\nThis link works once and expires in one hour.',
            action: { label: 'Choose a new password', url },
            footer: 'If you did not request this, you can safely ignore this email. Your password has not changed.'
          }
        }])
      }
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await queueVerificationEmail(user, url)
      }
    },

    socialProviders: env.googleClientId && env.googleClientSecret
      ? {
          google: {
            clientId: env.googleClientId,
            clientSecret: env.googleClientSecret
          }
        }
      : {},

    user: {
      fields: { image: 'avatarUrl' },
      additionalFields: {
        username: { type: 'string', required: false, input: true },
        timeZone: { type: 'string', required: false, input: true }
      }
    },

    plugins: [
      organization({
        ac: accessControl,
        roles: organizationAccessRoles,
        creatorRole: 'owner',
        organizationLimit: 5,

        invitationExpiresIn: TEAM_PLAN.invitationExpiryDays * 24 * 60 * 60,
        // Re-inviting supersedes the old link, so a revoked or forwarded
        // invitation cannot be redeemed after a fresh one goes out.
        cancelPendingInvitationsOnReInvite: true,
        // The invited address is the proof of ownership, so it has to be
        // verified before the invitation can be redeemed.
        requireEmailVerificationOnInvitation: true,

        membershipLimit: async (_user, org) => {
          const entitlement = await organizationEntitlement(org.id)
          return entitlement.seatLimit
        },

        // Archiving replaces deletion so booking history and audit records
        // survive; the endpoint that archives also frees the public slug.
        disableOrganizationDeletion: true,

        sendInvitationEmail: async (data) => {
          const url = `${env.schedraUrl}/invite/${data.id}`
          await enqueueEmails([{
            dedupeKey: emailDedupeKey('organization-invitation', data.id),
            email: {
              to: data.email,
              subject: `${data.inviter.user.name} invited you to ${data.organization.name} on Schedra`,
              preheader: `Join ${data.organization.name} to share team booking links.`,
              heading: `Join ${data.organization.name}`,
              body: `${data.inviter.user.name} (${data.inviter.user.email}) invited you to join ${data.organization.name} on Schedra as ${data.role === 'admin' ? 'an admin' : 'a member'}.\n\nYour personal booking page, availability and calendar stay yours — joining a team never moves or shares them.`,
              action: { label: 'Review the invitation', url },
              footer: `This invitation expires in ${TEAM_PLAN.invitationExpiryDays} days and can only be accepted by ${data.email}. If you were not expecting it, you can safely ignore this email.`
            }
          }])
        },

        organizationHooks: {
          beforeCreateOrganization: async ({ organization: draft }) => {
            const parsed = createOrganizationSchema.safeParse({
              name: draft.name,
              slug: draft.slug
            })

            if (!parsed.success) {
              throw new APIError('BAD_REQUEST', {
                code: 'INVALID_ORGANIZATION',
                message: parsed.error.issues[0]?.message ?? 'Those team details are not valid.'
              })
            }

            // A slug retired by a rename still resolves old booking links, so
            // it cannot be handed to a different team.
            const [taken] = await useDatabase()
              .select({ id: schema.organizationSlugHistory.id })
              .from(schema.organizationSlugHistory)
              .where(sql`lower(${schema.organizationSlugHistory.slug}) = ${parsed.data.slug}`)
              .limit(1)

            if (taken) {
              throw new APIError('BAD_REQUEST', {
                code: 'SLUG_TAKEN',
                message: 'That team address is already taken.'
              })
            }

            return { data: { ...draft, ...parsed.data } }
          },

          afterCreateOrganization: async ({ organization: created, user }) => {
            await startTrial(created.id)
            await recordAudit({
              organizationId: created.id,
              actorUserId: user.id,
              actorEmail: user.email,
              action: 'organization.created',
              metadata: { name: created.name, slug: created.slug }
            })
          },

          // The public slug is how old booking links resolve, so renames go
          // through an endpoint that records the previous one.
          beforeUpdateOrganization: async ({ organization: changes }) => {
            if (changes.slug !== undefined) {
              throw new APIError('BAD_REQUEST', {
                code: 'SLUG_CHANGE_NOT_ALLOWED',
                message: 'Change the team address from team settings so old links keep working.'
              })
            }
            if (changes.logo !== undefined) {
              throw new APIError('BAD_REQUEST', {
                code: 'LOGO_CHANGE_NOT_ALLOWED',
                message: 'Upload the team logo from team branding settings.'
              })
            }
          },

          // Seats are billed as occupied, so acceptance is where the bill grows
          // — and where a team behind on payment has to stop growing.
          beforeAcceptInvitation: async ({ invitation }) => {
            await assertCanAddMember(invitation.organizationId)
          },

          afterAcceptInvitation: async ({ invitation, member, user }) => {
            await enqueueSubscriptionSeatSync(invitation.organizationId)
            await recordAudit({
              organizationId: invitation.organizationId,
              actorUserId: user.id,
              actorEmail: user.email,
              action: 'invitation.accepted',
              targetType: 'member',
              targetId: member.id,
              metadata: { role: invitation.role, email: invitation.email }
            })
          },

          afterRejectInvitation: async ({ invitation, user }) => {
            await recordAudit({
              organizationId: invitation.organizationId,
              actorUserId: user.id,
              actorEmail: invitation.email,
              action: 'invitation.rejected',
              targetType: 'invitation',
              targetId: invitation.id
            })
          },

          afterCreateInvitation: async ({ invitation, inviter }) => {
            await recordAudit({
              organizationId: invitation.organizationId,
              actorUserId: inviter.id,
              actorEmail: inviter.email,
              action: 'invitation.sent',
              targetType: 'invitation',
              targetId: invitation.id,
              metadata: { email: invitation.email, role: invitation.role }
            })
          },

          afterCancelInvitation: async ({ invitation, cancelledBy }) => {
            await recordAudit({
              organizationId: invitation.organizationId,
              actorUserId: cancelledBy.id,
              actorEmail: cancelledBy.email,
              action: 'invitation.revoked',
              targetType: 'invitation',
              targetId: invitation.id,
              metadata: { email: invitation.email }
            })
          },

          afterUpdateMemberRole: async ({ member, previousRole, user }) => {
            await recordAudit({
              organizationId: member.organizationId,
              actorUserId: user.id,
              actorEmail: user.email,
              action: 'member.role_changed',
              targetType: 'member',
              targetId: member.id,
              metadata: { from: previousRole, to: member.role }
            })
          },

          // An organization must always have an owner, so the last one cannot
          // leave or be removed until ownership is transferred.
          beforeRemoveMember: async ({ member }) => {
            if (member.role !== 'owner') return

            const remaining = await countMembersWithRole(member.organizationId, 'owner')
            if (remaining <= 1) {
              throw new APIError('BAD_REQUEST', {
                code: 'LAST_OWNER',
                message: 'Transfer ownership to someone else before leaving this team.'
              })
            }
          },

          afterRemoveMember: async ({ member, user }) => {
            await enqueueSubscriptionSeatSync(member.organizationId)
            await recordAudit({
              organizationId: member.organizationId,
              actorUserId: user.id,
              actorEmail: user.email,
              action: 'member.removed',
              targetType: 'member',
              targetId: member.id,
              metadata: { userId: member.userId }
            })
          }
        }
      })
    ],

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const record = user as typeof user & {
              username?: string | null
              timeZone?: string | null
            }
            const username = record.username
              || await deriveUsername(record.name ?? record.email)
            const parsed = accountProfileSchema.safeParse({
              name: record.name,
              email: record.email,
              username,
              ...(record.timeZone ? { timeZone: record.timeZone } : {})
            })

            if (!parsed.success) {
              throw new APIError('BAD_REQUEST', {
                code: 'INVALID_USER_PROFILE',
                message: parsed.error.issues[0]?.message ?? 'Those account details are not valid.'
              })
            }

            return { data: { ...user, ...parsed.data } }
          },
          after: async (user) => {
            const record = user as typeof user & { timeZone?: string | null }

            // A booking link that resolves to nothing is worse than no link, so
            // every account starts with hours and something to book.
            await createStarterSetup(user.id, record.timeZone || 'UTC')
          }
        }
      }
    },

    advanced: {
      ipAddress: {
        ipAddressHeaders: ['x-real-ip']
      },
      database: {
        generateId: () => crypto.randomUUID()
      }
    }
  })
}

async function deriveUsername(seed: string) {
  const { users } = schema
  const db = useDatabase()

  const base = seed
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'user'

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${candidate}`)
      .limit(1)

    if (!taken) return candidate
  }

  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

let cached: ReturnType<typeof createAuth> | null = null

export function useAuth() {
  cached ??= createAuth()
  return cached
}
