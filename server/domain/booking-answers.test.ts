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

  it('skips blank optional answers and rejects overlong text safely', () => {
    const optionalShort: BookingQuestion = {
      id: 'a0e81573-f9f7-40ef-ab93-3435c7127260',
      label: 'Short context',
      type: 'short_text',
      required: false,
      options: []
    }
    const optionalLong: BookingQuestion = {
      id: '48df28d2-5746-4c4a-a4b3-16ddfa3cf015',
      label: 'Long context',
      type: 'long_text',
      required: false,
      options: []
    }

    expect(buildBookingAnswersSnapshot([optionalShort], undefined, '  ')).toBeNull()
    expect(() => buildBookingAnswersSnapshot(
      [optionalShort],
      { [optionalShort.id]: 'x'.repeat(501) },
      undefined
    )).toThrow('under 500 characters')
    expect(() => buildBookingAnswersSnapshot(
      [optionalLong],
      { [optionalLong.id]: 'x'.repeat(2001) },
      undefined
    )).toThrow('under 2,000 characters')
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

  it('normalizes malformed stored answers instead of exposing unsafe values', () => {
    expect(readBookingAnswers(null)).toEqual({ version: 1, responses: [] })
    expect(readBookingAnswers({
      responses: [
        null,
        {},
        { questionId: 'one', label: 'Unsafe', type: 'html', value: '<b>bad</b>' },
        { questionId: 'two', label: 'Safe', type: 'short_text', value: 'Plain text' }
      ],
      notes: 42
    })).toEqual({
      version: 1,
      responses: [{
        questionId: 'two',
        label: 'Safe',
        type: 'short_text',
        value: 'Plain text'
      }]
    })
    expect(bookingAnswersText(undefined)).toBe('')
  })
})
