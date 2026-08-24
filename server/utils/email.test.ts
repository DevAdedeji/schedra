import { describe, expect, it } from 'vitest'
import { renderEmailHtml, renderEmailText, type Email } from './email'

const message: Email = {
  to: 'guest@example.com',
  subject: 'Confirmed: Design & planning',
  preheader: 'Your meeting is confirmed.',
  heading: 'You are booked <today>',
  body: 'Your meeting is confirmed.\n\nEverything you need is below.',
  details: [
    { label: 'When', value: 'Friday, 7 September, 09:00–09:30 WAT' },
    {
      label: 'Where',
      value: 'Open video call',
      url: 'https://meet.example.com/room?guest=one&source=email'
    }
  ],
  action: {
    label: 'View booking',
    url: 'https://schedra.example/booking/secret-token'
  },
  footer: 'Only use the link if you made this booking.'
}

describe('transactional email rendering', () => {
  it('renders a responsive, escaped HTML summary', () => {
    const html = renderEmailHtml(message)

    expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">')
    expect(html).toContain('@media screen and (max-width:480px)')
    expect(html).toContain('You are booked &lt;today&gt;')
    expect(html).not.toContain('You are booked <today>')
    expect(html).toContain('Design &amp; planning')
    expect(html).toContain('guest=one&amp;source=email')
    expect(html).toContain('Your meeting is confirmed.&#847;')
  })

  it('includes the full summary and action in the plain-text alternative', () => {
    expect(renderEmailText(message)).toBe(`You are booked <today>

Your meeting is confirmed.

Everything you need is below.

When: Friday, 7 September, 09:00–09:30 WAT
Where: Open video call

View booking: https://schedra.example/booking/secret-token

Only use the link if you made this booking.

— Schedra`)
  })

  it('rejects non-web action URLs', () => {
    expect(() => renderEmailHtml({
      ...message,
      action: { label: 'Unsafe', url: 'javascript:alert(1)' }
    })).toThrow('Email action URL must use HTTP or HTTPS.')
  })
})
