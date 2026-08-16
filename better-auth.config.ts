// Consumed only by `@better-auth/cli` for schema generation. The app itself
// builds the instance lazily through `useAuth()` so nothing connects at import.
import { useAuth } from './server/utils/auth'

export const auth = useAuth()
