import { describe, expect, it } from 'vitest'
import { organizationBrandingSchema, readableTextColor } from '#shared/branding'
import { organizationAccessRoles } from '#shared/organization-access'
import { teamEventTemplateDefaultsSchema } from '#shared/validation'

const defaults = {
  title: 'Discovery call',
  description: 'A short introduction.',
  durationMinutes: 30,
  additionalDurationMinutes: [60],
  recurringBookingEnabled: false,
  recurringBookingMaxOccurrences: 8,
  incrementMinutes: null,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  minimumNoticeMinutes: 120,
  bookingWindowDays: 60,
  maxPerDay: 4,
  locationType: 'custom',
  locationDetails: 'The host will share meeting details.',
  reminderMinutes: [1440, 60],
  bookingQuestions: [],
  requiresConfirmation: false,
  capacity: 1,
  hidden: false,
  assignmentMode: 'round_robin'
}

describe('team managed customization rules', () => {
  it('lets owners and admins manage templates and branding but not members', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(organizationAccessRoles[role].authorize({ eventType: ['create', 'update', 'delete'] }).success).toBe(true)
      expect(organizationAccessRoles[role].authorize({ organization: ['update'] }).success).toBe(true)
    }
    expect(organizationAccessRoles.member.authorize({ eventType: ['create'] }).success).toBe(false)
    expect(organizationAccessRoles.member.authorize({ organization: ['update'] }).success).toBe(false)
  })

  it('accepts complete reusable defaults without hosts, links or payment', () => {
    expect(teamEventTemplateDefaultsSchema.parse(defaults)).toEqual(defaults)
    expect(teamEventTemplateDefaultsSchema.safeParse({ ...defaults, durationMinutes: 0 }).success).toBe(false)
    expect(teamEventTemplateDefaultsSchema.safeParse({ ...defaults, locationDetails: '' }).success).toBe(false)
  })

  it('normalizes safe team colours and chooses accessible button text', () => {
    const branding = organizationBrandingSchema.parse({
      brandColor: '#fefefe',
      brandDarkColor: '#123456',
      bookingPageTheme: 'system',
      hideSchedraBranding: false
    })
    expect(branding.brandColor).toBe('#FEFEFE')
    expect(readableTextColor(branding.brandColor)).toBe('#1C1917')
    expect(readableTextColor(branding.brandDarkColor)).toBe('#FFFFFF')
    expect(organizationBrandingSchema.safeParse({ ...branding, brandColor: 'red' }).success).toBe(false)
  })
})
