import { afterEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ billingMode: 'sandbox', bachsSecretKey: 'never-expose-this' }))
vi.mock('../config/env', () => ({ useEnv: () => env }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('public payment environment', () => {
  it.each(['sandbox', 'live', 'disabled'])('exposes only %s mode and never caches it', async (mode) => {
    env.billingMode = mode
    const setHeader = vi.fn()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('setHeader', setHeader)
    const { default: handler } = await import('./payment-environment.get')
    expect(handler({} as never)).toEqual({ mode })
    expect(setHeader).toHaveBeenCalledWith({}, 'Cache-Control', 'no-store')
  })
})
