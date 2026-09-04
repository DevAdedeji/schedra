import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('booking email template persistence and entitlement', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()
    await sql`
      truncate table
        email_outbox, personal_subscriptions, organization_subscriptions,
        members, users, organizations
      restart identity cascade
    `
  })

  afterAll(async () => {
    await sql`
      truncate table
        email_outbox, personal_subscriptions, organization_subscriptions,
        members, users, organizations
      restart identity cascade
    `
    await sql.end()
  })

  async function userFixture(suffix: string) {
    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values (
        ${`${suffix}@example.com`},
        ${`${suffix} Host`},
        ${suffix},
        true,
        'Africa/Lagos'
      ) returning id
    `
    return user!
  }

  function settings(subject: string) {
    return {
      templates: {
        confirmation: { subject, body: 'Hello {{guest_name}}, {{event_name}} is with {{host_name}} at {{start_time}}.' },
        reminder: null,
        reschedule: null,
        request: null,
        rejection: null,
        cancellation: null
      },
      footer: 'A custom footer.'
    }
  }

  function notice(hostId: string, suffix: string, organizationId?: string) {
    return {
      uid: `email-${suffix}`,
      organizationId,
      eventTitle: 'Product demo',
      hostUserId: hostId,
      hostName: 'Taylor Host',
      hostUsername: suffix,
      hostEmail: `${suffix}@example.com`,
      hostTimeZone: 'Africa/Lagos',
      attendeeName: 'Maya Guest',
      attendeeEmail: `guest-${suffix}@example.com`,
      additionalGuestEmails: [],
      attendeeTimeZone: 'Europe/London',
      startsAt: '2030-09-07T08:00:00Z',
      endsAt: '2030-09-07T08:30:00Z',
      locationType: 'phone' as const,
      locationDetails: '+2348000000000',
      reminderMinutes: []
    }
  }

  it('keeps saved personal customization dormant without Personal Pro', async () => {
    const host = await userFixture('free-host')
    await sql`
      update users set booking_email_templates = ${sql.json(settings('Custom: {{event_name}}'))}
      where id = ${host.id}
    `
    const { queueBookingEmails } = await import('../services/booking-emails')
    await queueBookingEmails(notice(host.id, 'free-host'))

    const [guest] = await sql<{ subject: string, branding: unknown }[]>`
      select subject, branding from email_outbox
      where recipient = 'guest-free-host@example.com'
    `
    expect(guest).toEqual({ subject: 'Confirmed: Product demo with Taylor Host', branding: null })
  })

  it('snapshots Personal Pro wording, footer and branding into the outbox', async () => {
    const host = await userFixture('pro-host')
    await sql`
      insert into personal_subscriptions (
        user_id, status, interval, collection_method, current_period_end
      ) values (${host.id}, 'active', 'yearly', 'charge_automatically', now() + interval '1 year')
    `
    await sql`
      update users set
        brand_name = 'North Studio',
        brand_color = '#123456',
        hide_schedra_branding = true,
        booking_email_templates = ${sql.json(settings('Welcome: {{event_name}}'))}
      where id = ${host.id}
    `
    const { queueBookingEmails } = await import('../services/booking-emails')
    await queueBookingEmails(notice(host.id, 'pro-host'))
    await sql`
      update users set
        brand_name = 'Changed later',
        booking_email_templates = ${sql.json(settings('Changed: {{event_name}}'))}
      where id = ${host.id}
    `

    const [guest] = await sql<{
      subject: string
      body: string
      preheader: string
      footer: string
      branding: { name: string, accentColor: string, hideSchedraBranding: boolean }
    }[]>`
      select subject, body, preheader, footer, branding from email_outbox
      where recipient = 'guest-pro-host@example.com'
    `
    expect(guest).toMatchObject({
      subject: 'Welcome: Product demo',
      body: expect.stringContaining('Maya Guest'),
      preheader: expect.stringContaining('Maya Guest'),
      footer: 'A custom footer.',
      branding: { name: 'North Studio', accentColor: '#123456', hideSchedraBranding: true }
    })
  })

  it('uses active team settings and leaves host alerts unbranded', async () => {
    const host = await userFixture('team-host')
    const [organization] = await sql<{ id: string }[]>`
      insert into organizations (
        name, slug, brand_color, hide_schedra_branding, booking_email_templates
      ) values (
        'Acme Team', 'acme-team', '#ABCDEF', false,
        ${sql.json(settings('Acme confirmed: {{event_name}}'))}
      ) returning id
    `
    await sql`
      insert into members (organization_id, user_id, role)
      values (${organization!.id}, ${host.id}, 'owner')
    `
    await sql`
      insert into organization_subscriptions (
        organization_id, status, interval, collection_method, current_period_end
      ) values (${organization!.id}, 'active', 'yearly', 'charge_automatically', now() + interval '1 year')
    `

    const { queueBookingEmails } = await import('../services/booking-emails')
    await queueBookingEmails(notice(host.id, 'team-host', organization!.id))

    const messages = await sql<{
      recipient: string
      subject: string
      branding: { name: string, accentColor: string } | null
    }[]>`select recipient, subject, branding from email_outbox order by recipient`
    expect(messages.find(message => message.recipient === 'guest-team-host@example.com')).toMatchObject({
      subject: 'Acme confirmed: Product demo',
      branding: { name: 'Acme Team', accentColor: '#ABCDEF' }
    })
    expect(messages.find(message => message.recipient === 'team-host@example.com')).toMatchObject({
      subject: 'New booking: Product demo',
      branding: null
    })
  })
})
