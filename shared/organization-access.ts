import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'

/**
 * Better Auth's defaults cover organization/member/invitation; the rest are
 * Schedra's own. Every organization endpoint checks these on the server — the
 * UI hiding a button is never the control.
 */
export const organizationStatements = {
  ...defaultStatements,
  eventType: ['create', 'update', 'delete'],
  booking: ['viewAll', 'manageAll'],
  billing: ['manage'],
  slug: ['update'],
  ownership: ['transfer']
} as const

export const accessControl = createAccessControl(organizationStatements)

export const ownerRole = accessControl.newRole({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  eventType: ['create', 'update', 'delete'],
  booking: ['viewAll', 'manageAll'],
  billing: ['manage'],
  slug: ['update'],
  ownership: ['transfer']
})

/**
 * Admins run the workspace day to day but cannot touch anything that is either
 * irreversible or financial: archiving, billing, the public slug, and handing
 * over ownership all stay with the owner.
 */
export const adminRole = accessControl.newRole({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  eventType: ['create', 'update', 'delete'],
  booking: ['viewAll', 'manageAll']
})

export const memberRole = accessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ['read'],
  eventType: [],
  booking: []
})

export const organizationAccessRoles = {
  owner: ownerRole,
  admin: adminRole,
  member: memberRole
}
