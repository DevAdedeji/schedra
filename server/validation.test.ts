import { describe, expect, it } from 'vitest'
import {
  accountProfileSchema,
  createBookingSchema,
  emailSchema,
  eventTypeSchema,
  passwordSchema,
  scheduleSchema,
  updateProfileSchema,
  timeZoneSchema
} from '../shared/validation'

describe('authentication validation', () => {
  it('normalizes email addresses', () => {
    expect(emailSchema.parse('  ADA@EXAMPLE.COM ')).toBe('ada@example.com')
  })

  it('keeps the client password limit aligned at 200 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(200)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(201)).success).toBe(false)
  })

  it('accepts real IANA time zones and rejects invented ones', () => {
    expect(timeZoneSchema.safeParse('Africa/Lagos').success).toBe(true)
    expect(timeZoneSchema.safeParse('Somewhere/Imaginary').success).toBe(false)
  })

  it('applies profile limits outside the browser form', () => {
    const profile = {
      name: 'a'.repeat(81),
      username: 'ada',
      email: 'ada@example.com',
      timeZone: 'Africa/Lagos'
    }

    expect(accountProfileSchema.safeParse(profile).success).toBe(false)
  })

  it('rejects invented time zones at every write boundary', () => {
    const fakeZone = 'Somewhere/Imaginary'

    expect(createBookingSchema.safeParse({
      username: 'ada',
      slug: 'intro',
      start: '2026-08-22T12:00:00.000Z',
      name: 'Grace',
      email: 'grace@example.com',
      timeZone: fakeZone
    }).success).toBe(false)
    expect(updateProfileSchema.safeParse({ name: 'Ada', timeZone: fakeZone }).success).toBe(false)
    expect(scheduleSchema.safeParse({ timeZone: fakeZone, rules: [] }).success).toBe(false)
  })

  it('constrains event type slugs and scheduling limits', () => {
    const valid = {
      title: 'Intro call',
      slug: 'intro-call',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 5,
      minimumNoticeMinutes: 120,
      bookingWindowDays: 60,
      maxPerDay: 8,
      locationType: 'video_link',
      locationDetails: 'https://meet.example.com/intro',
      reminderMinutes: [1440, 60],
      bookingQuestions: [],
      hidden: false
    }

    expect(eventTypeSchema.safeParse(valid).success).toBe(true)
    expect(eventTypeSchema.safeParse({ ...valid, slug: '../admin' }).success).toBe(false)
    expect(eventTypeSchema.safeParse({ ...valid, durationMinutes: 0 }).success).toBe(false)
    expect(eventTypeSchema.safeParse({ ...valid, maxPerDay: 0 }).success).toBe(false)
    expect(eventTypeSchema.safeParse({ ...valid, locationDetails: 'not a link' }).success).toBe(false)
    expect(eventTypeSchema.parse({ ...valid, reminderMinutes: [60, 1440, 60] }).reminderMinutes).toEqual([1440, 60])
  })

  it('validates guest questions and their choice options', () => {
    const question = {
      id: 'f5d799e8-5773-4fcf-9dc7-cb82e4efbd73',
      label: 'What would you like to discuss?',
      type: 'select' as const,
      required: true,
      options: ['Product strategy', 'Technical review']
    }
    const base = {
      title: 'Intro call',
      slug: 'intro-call',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minimumNoticeMinutes: 120,
      locationType: 'custom' as const,
      locationDetails: 'Details will be shared.',
      reminderMinutes: [],
      hidden: false
    }

    expect(eventTypeSchema.safeParse({ ...base, bookingQuestions: [question] }).success).toBe(true)
    expect(eventTypeSchema.safeParse({
      ...base,
      bookingQuestions: [{ ...question, options: ['Same', 'same'] }]
    }).success).toBe(false)
    expect(eventTypeSchema.safeParse({
      ...base,
      bookingQuestions: Array.from({ length: 11 }, (_, index) => ({
        ...question,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      }))
    }).success).toBe(false)
  })

  it('accepts unavailable and custom date overrides but rejects partial or reversed hours', () => {
    const base = { timeZone: 'Africa/Lagos', rules: [] }

    expect(scheduleSchema.safeParse({
      ...base,
      overrides: [
        { date: '2026-12-24', start: null, end: null },
        { date: '2026-12-31', start: '09:00', end: '13:00' }
      ]
    }).success).toBe(true)
    expect(scheduleSchema.safeParse({
      ...base,
      overrides: [{ date: '2026-12-24', start: '09:00', end: null }]
    }).success).toBe(false)
    expect(scheduleSchema.safeParse({
      ...base,
      overrides: [{ date: '2026-12-24', start: '17:00', end: '09:00' }]
    }).success).toBe(false)
  })
})
