/** Liveness intentionally does not depend on Postgres or another provider. */
export default defineEventHandler(() => ({ ok: true }))
