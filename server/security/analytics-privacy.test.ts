import { describe, expect, it } from 'vitest'
import { analyticsPageForRoute, analyticsReferrerOrigin } from '../../shared/analytics'

describe('Umami route privacy', () => {
  it('keeps useful names for informational pages', () => {
    expect(analyticsPageForRoute('index')).toEqual({ path: '/', title: 'Home' })
    expect(analyticsPageForRoute('features')).toEqual({ path: '/features', title: 'Features' })
    expect(analyticsPageForRoute('pricing')).toEqual({ path: '/pricing', title: 'Pricing' })
  })

  it('replaces dynamic booking and capability routes with safe categories', () => {
    expect(analyticsPageForRoute('username-slug').path).toBe('/booking/personal')
    expect(analyticsPageForRoute('team-slug-event').path).toBe('/booking/team')
    expect(analyticsPageForRoute('booking-uid').path).toBe('/booking/details')
    expect(analyticsPageForRoute('meeting-token').path).toBe('/booking/private-link')
  })

  it('normalizes unmapped route names without accepting URL values', () => {
    expect(analyticsPageForRoute('t-slug-payments')).toEqual({
      path: '/page/t-slug-payments',
      title: 'T Slug Payments'
    })
    expect(analyticsPageForRoute(undefined)).toEqual({
      path: '/page/unknown',
      title: 'Unknown page'
    })
  })

  it('keeps only the origin of a referrer', () => {
    expect(analyticsReferrerOrigin('https://example.com/private/path?token=secret')).toBe('https://example.com')
    expect(analyticsReferrerOrigin('not-a-url')).toBe('')
    expect(analyticsReferrerOrigin(undefined)).toBe('')
  })
})
