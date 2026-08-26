import { createAuthClient } from 'better-auth/vue'
import { inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { accessControl, organizationAccessRoles } from '#shared/organization-access'
import type { useAuth } from '~~/server/utils/auth'

let client: ReturnType<typeof create> | null = null

function create() {
  return createAuthClient({
    plugins: [
      inferAdditionalFields<ReturnType<typeof useAuth>>(),
      // The same roles the server enforces, so `checkRolePermission` in the UI
      // agrees with what the API will actually allow.
      organizationClient({ ac: accessControl, roles: organizationAccessRoles })
    ]
  })
}

export function useAuthClient() {
  client ??= create()
  return client
}
