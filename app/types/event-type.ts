import type { BookingQuestion, MeetingLocationType } from '#shared/validation'

export interface EventTypeRecord {
  id: string
  title: string
  slug: string
  description: string | null
  durationMinutes: number
  additionalDurationMinutes: number[]
  recurringBookingEnabled: boolean
  recurringBookingMaxOccurrences: number
  incrementMinutes: number | null
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minimumNoticeMinutes: number
  bookingWindowDays: number | null
  maxPerDay: number | null
  maxPerWeek: number | null
  maxPerMonth: number | null
  locationType: MeetingLocationType
  locationDetails: string
  reminderMinutes: number[]
  bookingQuestions: BookingQuestion[]
  requiresConfirmation: boolean
  capacity: number
  paymentEnabled: boolean
  priceCents: number | null
  paymentCurrency: 'USD' | 'NGN'
  scheduleId: string | null
  scheduleName: string | null
  hidden: boolean
}
