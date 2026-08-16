import { useEnv } from '../utils/env'

export default defineNitroPlugin(() => {
  // Prerendering the marketing pages needs no database, so a missing .env must
  // not break `pnpm build` for someone who only wants the static site.
  if (import.meta.prerender) return

  useEnv()
})
