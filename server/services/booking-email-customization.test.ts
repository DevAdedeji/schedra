import { describe, expect, it } from 'vitest'
import {
  bookingEmailTemplateSettingsSchema,
  DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS,
  renderBookingEmailTemplate
} from '#shared/email-templates'
import { customizeGuestBookingEmail, type BookingEmailOwner } from './booking-email-customization'

const owner: BookingEmailOwner = {
  hostUserId: 'host-id',
  hostName: 'Alex & Co',
  attendeeName: '<Maya>',
  attendeeTimeZone: 'Africa/Lagos',
  eventTitle: 'Discovery call',
  startsAt: '2030-09-07T08:00:00Z'
}

describe('booking email customization', () => {
  it('accepts only safe text and supported variables', () => {
    const input = structuredClone(DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS)
    input.templates.confirmation = {
      subject: 'Welcome {{guest_name}}',
      body: 'Your {{event_name}} starts at {{start_time}}.'
    }
    expect(bookingEmailTemplateSettingsSchema.safeParse(input).success).toBe(true)

    input.templates.confirmation.body = 'Open {{manage_url}}'
    expect(bookingEmailTemplateSettingsSchema.safeParse(input).success).toBe(false)
    input.templates.confirmation.body = 'Hello {{ guest_name }}'
    expect(bookingEmailTemplateSettingsSchema.safeParse(input).success).toBe(false)
    input.templates.confirmation.body = 'Hello {{guest_name'
    expect(bookingEmailTemplateSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('replaces every supported variable without interpreting HTML', () => {
    expect(renderBookingEmailTemplate({
      subject: '{{guest_name}} — {{event_name}}',
      body: '{{host_name}} will meet you in {{time_zone}} at {{start_time}}.'
    }, {
      '{{guest_name}}': '<Maya>',
      '{{event_name}}': 'Discovery call',
      '{{host_name}}': 'Alex & Co',
      '{{start_time}}': '10:00',
      '{{time_zone}}': 'Africa/Lagos'
    })).toEqual({
      subject: '<Maya> — Discovery call',
      body: 'Alex & Co will meet you in Africa/Lagos at 10:00.'
    })
  })

  it('changes only guest wording, footer and presentation', () => {
    const email = customizeGuestBookingEmail('confirmation', {
      to: 'guest@example.com',
      subject: 'Default subject',
      heading: 'You are booked',
      body: 'Default body',
      action: { label: 'View booking', url: 'https://schedra.example/booking/token' },
      footer: 'Default footer'
    }, owner, {
      settings: {
        templates: {
          ...DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS.templates,
          confirmation: {
            subject: 'Welcome {{guest_name}}',
            body: '{{event_name}} is booked with {{host_name}}.'
          }
        },
        footer: 'Thank you for choosing us.'
      },
      branding: {
        name: 'Alex & Co',
        accentColor: '#123456',
        hideSchedraBranding: true
      }
    })

    expect(email).toMatchObject({
      subject: 'Welcome <Maya>',
      body: 'Discovery call is booked with Alex & Co.',
      heading: 'You are booked',
      action: { label: 'View booking', url: 'https://schedra.example/booking/token' },
      footer: 'Thank you for choosing us.',
      branding: { name: 'Alex & Co', accentColor: '#123456' }
    })
  })
})
