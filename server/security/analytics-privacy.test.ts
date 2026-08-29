import { describe, expect, it } from 'vitest'
import { analyticsAllowedForRoute } from '../../shared/analytics'

describe('analytics route privacy', () => {
  it('allows Clarity only on informational marketing pages', () => {
    expect(analyticsAllowedForRoute('index')).toBe(true)
    expect(analyticsAllowedForRoute('features')).toBe(true)
    expect(analyticsAllowedForRoute('pricing')).toBe(true)
  })

  it('excludes booking, account, authentication and financial routes', () => {
    for (const route of [
      'username-slug', 'team-slug-event', 'booking-uid', 'meeting-token',
      'login', 'verify-email', 'dashboard', 'payments', 'operations', 't-slug-payments'
    ]) {
      expect(analyticsAllowedForRoute(route)).toBe(false)
    }
  })
})
