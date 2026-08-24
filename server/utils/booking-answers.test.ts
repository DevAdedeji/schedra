import { describe, expect, it } from 'vitest'
import type { BookingQuestion } from '#shared/validation'
import {
  BookingAnswerValidationError,
  bookingAnswersText,
  buildBookingAnswersSnapshot,
  readBookingAnswers
} from './booking-answers'

const questions: BookingQuestion[] = [
  {
    id: '3a4642d6-ec82-4d53-aa13-d8f2606e5277',
    label: 'What would you like to discuss?',
    type: 'long_text',
    required: true,
    options: []
  },
  {
    id: '788d8781-f0d3-4055-bd36-3820587e91d7',
    label: 'Team size',
    type: 'select',
    required: false,
    options: ['Just me', '2–10', '11+']
  }
]

describe('booking answer snapshots', () => {
  it('stores labels and types with the response so history survives event edits', () => {
    expect(buildBookingAnswersSnapshot(questions, {
      [questions[0]!.id]: '  A scheduling review  ',
      [questions[1]!.id]: '2–10'
    }, ' Send an agenda ')).toEqual({
      version: 1,
      responses: [
        {
          questionId: questions[0]!.id,
          label: questions[0]!.label,
          type: 'long_text',
          value: 'A scheduling review'
        },
        {
          questionId: questions[1]!.id,
          label: questions[1]!.label,
          type: 'select',
          value: '2–10'
        }
      ],
      notes: 'Send an agenda'
    })
  })

  it('enforces required answers and rejects stale or forged options', () => {
    expect(() => buildBookingAnswersSnapshot(questions, {}, undefined))
      .toThrow(BookingAnswerValidationError)
    expect(() => buildBookingAnswersSnapshot(questions, {
      [questions[0]!.id]: 'Review',
      [questions[1]!.id]: 'Everyone'
    }, undefined)).toThrow('Choose one of the available options')
    expect(() => buildBookingAnswersSnapshot(questions, {
      [questions[0]!.id]: 'Review',
      'unknown-question': 'Forged'
    }, undefined)).toThrow('The booking form changed')
  })

  it('reads legacy notes and renders useful calendar context', () => {
    expect(readBookingAnswers({ notes: 'Legacy note' })).toEqual({
      version: 1,
      responses: [],
      notes: 'Legacy note'
    })
    expect(bookingAnswersText({
      version: 1,
      responses: [{
        questionId: questions[0]!.id,
        label: questions[0]!.label,
        type: 'long_text',
        value: 'Review onboarding'
      }],
      notes: 'Bring metrics'
    })).toBe('What would you like to discuss?: Review onboarding\nNotes: Bring metrics')
  })
})
