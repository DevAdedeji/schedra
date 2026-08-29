import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { BookingDetail, PublicBookingPage } from '~/services/schedra-api'

export function useBookingGuestForm(options: {
  prefillName: MaybeRefOrGetter<string | undefined>
  prefillEmail: MaybeRefOrGetter<string | undefined>
  rescheduleBooking: MaybeRefOrGetter<BookingDetail | null | undefined>
  page: MaybeRefOrGetter<PublicBookingPage | null | undefined>
  additionalGuestLimit: MaybeRefOrGetter<number>
}) {
  const booking = reactive({ name: '', email: '', notes: '' })
  const bookingAnswers = reactive<Record<string, string>>({})
  const guestEmails = ref<string[]>([])
  const existing = toValue(options.rescheduleBooking)

  if (existing) {
    booking.name = existing.attendeeName
    booking.email = existing.attendeeEmail
    booking.notes = existing.notes ?? ''
    guestEmails.value = [...existing.additionalGuestEmails]
    for (const answer of existing.answers) {
      if (toValue(options.page)?.bookingQuestions.some(question => question.id === answer.questionId)) {
        bookingAnswers[answer.questionId] = answer.value
      }
    }
  } else {
    booking.name = toValue(options.prefillName)?.trim() ?? ''
    booking.email = toValue(options.prefillEmail)?.trim().toLowerCase() ?? ''
    if (import.meta.client && !booking.name && !booking.email) {
      const key = `schedra:routing-prefill:${window.location.pathname}`
      const stored = sessionStorage.getItem(key)
      sessionStorage.removeItem(key)
      if (stored) {
        try {
          const prefill = JSON.parse(stored) as { name?: string, email?: string, expiresAt?: number }
          if ((prefill.expiresAt ?? 0) > Date.now()) {
            booking.name = prefill.name?.trim() ?? ''
            booking.email = prefill.email?.trim().toLocaleLowerCase() ?? ''
          }
        } catch {
          // Malformed browser state should never prevent manual booking.
        }
      }
    }
  }

  function addGuest() {
    if (guestEmails.value.length < toValue(options.additionalGuestLimit)) guestEmails.value.push('')
  }

  function removeGuest(index: number) {
    guestEmails.value.splice(index, 1)
  }

  return { booking, bookingAnswers, guestEmails, addGuest, removeGuest }
}
