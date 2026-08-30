import { describe, expect, it } from 'vitest'
import { createBookingSchema, deleteAccountSchema, eventTypeSchema } from '../../shared/validation'

describe('new booking and account validation', () => {
  const booking = {
    username: 'host',
    slug: 'intro',
    start: '2030-09-07T08:00:00Z',
    name: 'Guest',
    email: 'Guest@example.com',
    timeZone: 'Africa/Lagos'
  }

  it('normalizes and deduplicates additional guests', () => {
    const parsed = createBookingSchema.parse({
      ...booking,
      guestEmails: ['Friend@Example.com', 'friend@example.com']
    })
    expect(parsed.email).toBe('guest@example.com')
    expect(parsed.guestEmails).toEqual(['friend@example.com'])
  })

  it('limits additional guests and requires explicit account deletion confirmation', () => {
    expect(createBookingSchema.safeParse({ ...booking, guestEmails: Array.from({ length: 11 }, (_, index) => `g${index}@example.com`) }).success).toBe(false)
    expect(deleteAccountSchema.safeParse({ email: 'guest@example.com', confirmation: 'delete' }).success).toBe(false)
    expect(deleteAccountSchema.safeParse({ email: 'guest@example.com', confirmation: 'DELETE' }).success).toBe(true)
  })

  it('defaults new event types to immediate confirmation', () => {
    const parsed = eventTypeSchema.parse({
      title: 'Intro',
      slug: 'intro',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minimumNoticeMinutes: 120,
      locationType: 'custom',
      locationDetails: 'Details follow',
      reminderMinutes: [60],
      hidden: false
    })
    expect(parsed.requiresConfirmation).toBe(false)
    expect(parsed.additionalDurationMinutes).toEqual([])
  })
})
