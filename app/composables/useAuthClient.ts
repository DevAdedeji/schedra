import { createAuthClient } from 'better-auth/vue'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { useAuth } from '~~/server/utils/auth'

let client: ReturnType<typeof create> | null = null

function create() {
  return createAuthClient({
    plugins: [inferAdditionalFields<ReturnType<typeof useAuth>>()]
  })
}

export function useAuthClient() {
  client ??= create()
  return client
}
