// The worker uses the same production Nitro bundle so service auto-imports,
// configuration and provider adapters behave exactly like the web process.
process.env.SCHEDRA_PROCESS_ROLE = 'worker'

await import('../.output/server/index.mjs')
