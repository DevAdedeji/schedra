import type {
  BookingAnswer,
  BookingAnswersSnapshot,
  BookingQuestion
} from '#shared/validation'

export class BookingAnswerValidationError extends Error {}

export function buildBookingAnswersSnapshot(
  questions: BookingQuestion[],
  submitted: Record<string, string> | undefined,
  notes: string | undefined
): BookingAnswersSnapshot | null {
  const knownIds = new Set(questions.map(question => question.id))
  const unknown = Object.keys(submitted ?? {}).find(id => !knownIds.has(id))
  if (unknown) throw new BookingAnswerValidationError('The booking form changed. Refresh the page and try again.')

  const responses: BookingAnswer[] = []
  for (const question of questions) {
    const value = submitted?.[question.id]?.trim() ?? ''
    if (!value) {
      if (question.required) throw new BookingAnswerValidationError(`Answer “${question.label}” before booking.`)
      continue
    }
    if (question.type === 'short_text' && value.length > 500) {
      throw new BookingAnswerValidationError(`Keep “${question.label}” under 500 characters.`)
    }
    if (question.type === 'long_text' && value.length > 2000) {
      throw new BookingAnswerValidationError(`Keep “${question.label}” under 2,000 characters.`)
    }
    if (question.type === 'select' && !question.options.includes(value)) {
      throw new BookingAnswerValidationError(`Choose one of the available options for “${question.label}”.`)
    }
    responses.push({
      questionId: question.id,
      label: question.label,
      type: question.type,
      value
    })
  }

  const cleanNotes = notes?.trim()
  if (!responses.length && !cleanNotes) return null
  return {
    version: 1,
    responses,
    ...(cleanNotes ? { notes: cleanNotes } : {})
  }
}

export function readBookingAnswers(value: unknown): BookingAnswersSnapshot {
  if (!value || typeof value !== 'object') return { version: 1, responses: [] }
  const candidate = value as Partial<BookingAnswersSnapshot> & { notes?: unknown }
  return {
    version: 1,
    responses: Array.isArray(candidate.responses)
      ? candidate.responses.filter((answer): answer is BookingAnswer => Boolean(
          answer
          && typeof answer === 'object'
          && typeof answer.questionId === 'string'
          && typeof answer.label === 'string'
          && ['short_text', 'long_text', 'select'].includes(answer.type)
          && typeof answer.value === 'string'
        ))
      : [],
    ...(typeof candidate.notes === 'string' && candidate.notes ? { notes: candidate.notes } : {})
  }
}

export function bookingAnswersText(value: unknown) {
  const snapshot = readBookingAnswers(value)
  return [
    ...snapshot.responses.map(answer => `${answer.label}: ${answer.value}`),
    ...(snapshot.notes ? [`Notes: ${snapshot.notes}`] : [])
  ].join('\n')
}
