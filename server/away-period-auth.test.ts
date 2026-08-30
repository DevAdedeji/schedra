import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAwayPeriods: vi.fn(),
  requireAuthSession: vi.fn()
}))

vi.mock('./services/away-periods', () => ({ listAwayPeriods: mocks.listAwayPeriods }))
vi.mock('./services/session', () => ({ requireAuthSession: mocks.requireAuthSession }))

describe('away period API authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('rejects an unauthenticated request before reading any periods', async () => {
    mocks.requireAuthSession.mockRejectedValue({ statusCode: 401, statusMessage: 'Not signed in' })
    const { default: handler } = await import('./api/away-periods/index.get')

    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.listAwayPeriods).not.toHaveBeenCalled()
  })

  it('scopes the list to the authenticated user', async () => {
    mocks.requireAuthSession.mockResolvedValue({ user: { id: 'user-123' } })
    mocks.listAwayPeriods.mockResolvedValue({ items: [], timeZone: 'UTC' })
    const { default: handler } = await import('./api/away-periods/index.get')

    await expect(handler({} as never)).resolves.toEqual({ items: [], timeZone: 'UTC' })
    expect(mocks.listAwayPeriods).toHaveBeenCalledWith('user-123')
  })
})
