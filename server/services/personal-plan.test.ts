import { describe, expect, it } from 'vitest'
import { personalBrandingSchema, readableTextColor } from '#shared/branding'
import { PERSONAL_PRO_PLAN, personalProPriceCents } from '#shared/billing'

describe('Personal Pro pricing', () => {
  it('charges $6 monthly or $60 yearly', () => {
    expect(personalProPriceCents('monthly')).toBe(600)
    expect(personalProPriceCents('yearly')).toBe(6000)
  })

  it('sets the reduced paid-booking fee to 2.5%', () => {
    expect(PERSONAL_PRO_PLAN.paidBookingFeeBps).toBe(250)
  })
})

describe('personal branding', () => {
  it('normalizes valid colours and rejects unsafe CSS values', () => {
    expect(personalBrandingSchema.parse({
      brandName: ' Acme ',
      brandColor: '#1d4ed8',
      brandDarkColor: '#60a5fa',
      bookingPageTheme: 'system',
      hideSchedraBranding: true
    })).toMatchObject({ brandName: 'Acme', brandColor: '#1D4ED8', brandDarkColor: '#60A5FA' })

    expect(() => personalBrandingSchema.parse({
      brandName: null,
      brandColor: 'url(https://example.com)',
      brandDarkColor: '#60A5FA',
      bookingPageTheme: 'dark',
      hideSchedraBranding: false
    })).toThrow()
  })

  it('chooses readable text for light and dark brand colours', () => {
    expect(readableTextColor('#FFFFFF')).toBe('#1C1917')
    expect(readableTextColor('#111827')).toBe('#FFFFFF')
  })
})
