import type { BookingQuestion, MeetingLocationType } from '#shared/validation'

export interface EventTypeRecord {
  id: string
  title: string
  slug: string
  description: string | null
  durationMinutes: number
  incrementMinutes: number | null
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minimumNoticeMinutes: number
  bookingWindowDays: number | null
  maxPerDay: number | null
  locationType: MeetingLocationType
  locationDetails: string
  reminderMinutes: number[]
  bookingQuestions: BookingQuestion[]
  scheduleId: string | null
  scheduleName: string | null
  hidden: boolean
}
