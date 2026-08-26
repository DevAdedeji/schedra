import { organizationAccessRoles } from '#shared/organization-access'
import { organizationContextPayload, requireOrganization } from '../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganization(event, slug)
  const payload = await organizationContextPayload(context)

  const can = (request: Parameters<typeof organizationAccessRoles.owner.authorize>[0]) =>
    organizationAccessRoles[context.role].authorize(request).success

  return {
    ...payload,
    // Sent so the UI can hide what it should; the server checks these again on
    // every call that matters.
    permissions: {
      inviteMembers: can({ invitation: ['create'] }),
      removeMembers: can({ member: ['delete'] }),
      changeRoles: can({ member: ['update'] }),
      updateTeam: can({ organization: ['update'] }),
      changeAddress: can({ slug: ['update'] }),
      transferOwnership: can({ ownership: ['transfer'] }),
      manageBilling: can({ billing: ['manage'] }),
      archiveTeam: can({ organization: ['delete'] }),
      manageEventTypes: can({ eventType: ['create'] }),
      viewAllBookings: can({ booking: ['viewAll'] })
    }
  }
})
