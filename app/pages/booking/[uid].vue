<script setup lang="ts">
import { apiErrorMessage, bookingsApi, type BookingDetail } from '~/services/schedra-api'
import { formatMoney } from '#shared/payments'
import { formatInstant, isPast, localTimeZone } from '~/utils/date-time'

definePageMeta({ layout: 'bare' })

const route = useRoute()
const uid = String(route.params.uid)

// The same page serves a guest arriving from an email and a host arriving from
// their bookings list. Only the signed-in one should get the app shell.
const { data: viewer } = await useCurrentUser()
const signedIn = computed(() => Boolean(viewer.value?.user))
if (signedIn.value) setPageLayout('app')

const { data: booking, error, status, refresh } = await useFetch<BookingDetail>(bookingsApi.detailEndpoint(uid))
if (error.value) setResponseStatus(error.value.statusCode === 404 ? 404 : 503)
const missingBooking = computed(() => error.value?.statusCode === 404)
const feedback = useFeedback()

const viewerTimeZone = ref('UTC')
onMounted(() => {
  viewerTimeZone.value = localTimeZone()
})

const cancelling = ref(false)
const confirming = ref(false)
const handlingRequest = ref<'approve' | 'reject' | null>(null)
const reason = ref('')
const cancelError = ref('')
const paymentCheckState = ref<'idle' | 'checking' | 'pending' | 'failed'>('idle')
const paymentCheckError = ref('')
let paymentCheckStopped = false

const cancelled = computed(() => booking.value?.status === 'cancelled')
const pendingApproval = computed(() => booking.value?.status === 'pending')
const awaitingPayment = computed(() => booking.value?.status === 'awaiting_payment')
const returningFromPayment = computed(() => route.query.payment === 'success' || typeof route.query.checkout_id === 'string')
const paymentRecoveryAvailable = computed(() => Boolean(booking.value?.payment?.recoveryAvailable))
const canReconcilePayment = computed(() => awaitingPayment.value || paymentRecoveryAvailable.value)
const rejected = computed(() => booking.value?.status === 'rejected')
const past = computed(() => booking.value ? isPast(booking.value.endsAt) : false)
const joinUrl = computed(() => booking.value?.status === 'confirmed'
  ? booking.value.meetingUrl ?? (booking.value.locationType === 'video_link' ? booking.value.locationDetails : null)
  : null)

const locationPresentation = computed(() => ({
  google_meet: { label: 'Google Meet', icon: 'i-simple-icons-googlemeet' },
  microsoft_teams: { label: 'Microsoft Teams', icon: 'i-simple-icons-microsoftteams' },
  zoom: { label: 'Zoom', icon: 'i-simple-icons-zoom' },
  video_link: { label: 'Video call', icon: 'i-lucide-video' },
  phone: { label: 'Phone call', icon: 'i-lucide-phone' },
  in_person: { label: 'In person', icon: 'i-lucide-map-pin' },
  custom: { label: 'Meeting details', icon: 'i-lucide-message-square-text' }
}[booking.value?.locationType ?? 'custom']))

const longWhen = computed(() => {
  if (!booking.value) return ''
  return formatInstant(booking.value.startsAt, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: viewerTimeZone.value
  }, 'en-GB')
})

async function cancel() {
  cancelling.value = true
  cancelError.value = ''

  try {
    const result = await bookingsApi.cancel(uid, reason.value || undefined) as { refundPending?: boolean }
    confirming.value = false
    await refresh()
    feedback.success({
      title: 'Booking cancelled',
      description: result.refundPending
        ? 'Your refund has started. Your bank will post it after processing.'
        : 'The host and guest will receive an updated confirmation.'
    })
  } catch (failure) {
    cancelError.value = apiErrorMessage(failure, 'Could not cancel that just now. Please try again.')
  } finally {
    cancelling.value = false
  }
}

async function handleRequest(action: 'approve' | 'reject') {
  handlingRequest.value = action
  cancelError.value = ''
  try {
    if (action === 'approve') await bookingsApi.approve(uid)
    else await bookingsApi.reject(uid, reason.value || undefined)
    await refresh()
    feedback.success({
      title: action === 'approve' ? 'Booking approved' : 'Request declined',
      description: action === 'approve' ? 'The guests have been notified.' : 'The guests have been notified and the time is free again.'
    })
  } catch (failure) {
    cancelError.value = apiErrorMessage(failure, `Could not ${action} this request. Please try again.`)
  } finally {
    handlingRequest.value = null
  }
}

async function clearPaymentReturnQuery() {
  const query = { ...route.query }
  delete query.payment
  delete query.checkout_id
  await navigateTo({ path: route.path, query }, { replace: true })
}

async function checkPaymentStatus(showFailure = true) {
  if (paymentCheckState.value === 'checking') return false
  paymentCheckState.value = 'checking'
  paymentCheckError.value = ''
  try {
    const result = await bookingsApi.reconcilePayment(uid)
    if (result.status === 'confirmed') {
      await refresh()
      await clearPaymentReturnQuery()
      feedback.success({
        title: 'Payment confirmed',
        description: 'Your booking is confirmed and the host can now see it.'
      })
      paymentCheckState.value = 'idle'
      return true
    }
    if (result.status === 'failed' || result.status === 'expired') {
      await refresh()
      paymentCheckState.value = 'failed'
      paymentCheckError.value = result.status === 'expired'
        ? 'This checkout expired before Bachs confirmed payment.'
        : 'Bachs did not confirm this payment. No booking was created.'
      return true
    }
    if (result.status === 'refund_pending') {
      await refresh()
      await clearPaymentReturnQuery()
      paymentCheckState.value = 'failed'
      paymentCheckError.value = 'The original time is no longer available. A refund has been started.'
      return true
    }
    paymentCheckState.value = 'pending'
    return false
  } catch (failure) {
    paymentCheckState.value = 'failed'
    paymentCheckError.value = apiErrorMessage(
      failure,
      'We could not verify the payment just now. Your payment is safe; try checking again.'
    )
    if (showFailure) feedback.error({ title: 'Could not verify payment', description: paymentCheckError.value })
    return false
  }
}

async function reconcileCheckoutReturn() {
  // Card settlements are normally immediate, but a bounded retry window also
  // covers providers that briefly report `processing` after redirecting.
  const delays = [0, 1_250, 2_500, 4_000, 6_000]
  for (const delay of delays) {
    if (paymentCheckStopped || !canReconcilePayment.value) return
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    if (paymentCheckStopped) return
    const terminal = await checkPaymentStatus(false)
    if (terminal) return
  }
  paymentCheckState.value = 'pending'
}

onMounted(() => {
  if (returningFromPayment.value && canReconcilePayment.value) void reconcileCheckoutReturn()
})

onBeforeUnmount(() => {
  paymentCheckStopped = true
})

useSeoMeta({
  title: () => booking.value ? `${booking.value.eventTitle} with ${booking.value.hostName}` : 'Booking',
  robots: 'noindex, nofollow'
})
</script>

<template>
  <div
    class="flex flex-col"
    :class="signedIn ? '' : 'min-h-screen bg-muted'"
  >
    <main
      class="flex-1"
      :class="signedIn ? '' : 'px-5 py-12 sm:py-16'"
    >
      <div class="mx-auto max-w-xl">
        <div class="mb-8">
          <NuxtLink
            v-if="!signedIn"
            to="/"
          >
            <SchedraMark />
          </NuxtLink>
          <NuxtLink
            v-else
            to="/bookings"
            class="inline-flex items-center gap-1.5 text-[14px] font-medium text-muted transition-colors hover:text-highlighted"
          >
            <UIcon
              name="i-lucide-arrow-left"
              class="size-3.5"
            />
            All bookings
          </NuxtLink>
        </div>

        <div
          v-if="status === 'pending' && !booking"
          class="overflow-hidden rounded-2xl border border-default bg-default"
          role="status"
          aria-label="Loading booking details"
        >
          <div class="space-y-4 px-6 py-8 sm:px-8">
            <USkeleton class="h-6 w-24 rounded-full" />
            <USkeleton class="h-8 w-3/4 rounded" />
            <USkeleton class="h-4 w-40 rounded" />
            <div class="space-y-3 pt-3">
              <USkeleton
                v-for="item in 4"
                :key="item"
                class="h-5 w-full rounded"
              />
            </div>
          </div>
          <div class="grid gap-3 border-t border-default px-6 py-6 sm:grid-cols-2 sm:px-8">
            <USkeleton class="h-10 w-full rounded-full" />
            <USkeleton class="h-10 w-full rounded-full" />
          </div>
        </div>

        <div
          v-else-if="missingBooking"
          class="rounded-2xl border border-default bg-default px-8 py-20 text-center"
        >
          <h1 class="font-editorial text-4xl text-highlighted">
            Nothing here.
          </h1>
          <p class="mt-4 text-base text-muted">
            This booking link is not valid. It may have been mistyped.
          </p>
        </div>

        <div
          v-else-if="error && !booking"
          class="overflow-hidden rounded-2xl border border-default bg-default"
        >
          <AsyncErrorState
            title="Could not load this booking"
            description="The booking link may still be valid. Check your connection and try again."
            :retrying="status === 'pending'"
            @retry="refresh"
          />
        </div>

        <div
          v-else
          class="overflow-hidden rounded-2xl border border-default bg-default"
        >
          <div class="px-6 py-7 sm:px-8">
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              :class="cancelled || rejected
                ? 'bg-elevated text-muted'
                : pendingApproval || awaitingPayment
                  ? 'bg-warning/10 text-warning'
                  : past
                    ? 'bg-elevated text-muted'
                    : 'bg-primary/10 text-primary'"
            >
              <span
                class="size-1.5 rounded-full"
                :class="cancelled || rejected || past ? 'bg-dimmed' : pendingApproval || awaitingPayment ? 'bg-warning' : 'bg-primary'"
              />
              {{ cancelled ? 'Cancelled' : rejected ? 'Declined' : awaitingPayment ? 'Awaiting payment' : pendingApproval ? 'Awaiting approval' : past ? 'Finished' : 'Confirmed' }}
            </span>

            <h1 class="mt-4 font-editorial text-3xl leading-tight text-highlighted">
              {{ booking?.eventTitle }}
            </h1>
            <p class="mt-1.5 text-[16px] text-muted">
              with {{ booking?.hostName }}
            </p>
            <p
              v-if="booking?.seriesPosition && booking.seriesOccurrenceCount"
              class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[12px] font-medium text-primary"
            >
              <UIcon
                name="i-lucide-calendar-sync"
                class="size-3.5"
              />
              Meeting {{ booking.seriesPosition }} of {{ booking.seriesOccurrenceCount }} · {{ booking.seriesFrequency === 'biweekly' ? 'every 2 weeks' : booking.seriesFrequency }}
            </p>

            <dl class="mt-6 space-y-3 text-[16px]">
              <div
                v-if="booking?.payment"
                class="flex items-start gap-3"
              >
                <UIcon
                  name="i-lucide-credit-card"
                  class="mt-0.5 size-4 shrink-0 text-dimmed"
                />
                <dd class="text-toned">
                  {{ formatMoney(booking.payment.amountCents, booking.payment.currency) }}
                  <span class="ml-1 text-[14px] text-muted">· {{ booking.payment.status.replace('_', ' ') }}</span>
                </dd>
              </div>
              <div class="flex items-start gap-3">
                <UIcon
                  name="i-lucide-calendar"
                  class="mt-0.5 size-4 shrink-0 text-dimmed"
                />
                <dd
                  class="text-toned"
                  :class="cancelled && 'line-through'"
                >
                  {{ longWhen }}
                </dd>
              </div>
              <div class="flex items-start gap-3">
                <UIcon
                  :name="locationPresentation?.icon"
                  class="mt-0.5 size-4 shrink-0 text-dimmed"
                />
                <dd class="min-w-0 text-toned">
                  <span class="block">{{ locationPresentation?.label }}</span>
                  <a
                    v-if="joinUrl && !cancelled"
                    :href="joinUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mt-0.5 block truncate text-[14px] font-medium text-primary hover:underline"
                  >Join meeting</a>
                  <span
                    v-else
                    class="mt-0.5 block text-[14px] leading-relaxed text-muted"
                  >{{ ['google_meet', 'microsoft_teams', 'zoom'].includes(booking?.locationType ?? '') ? 'The private join link is being prepared. Refresh this page shortly.' : booking?.locationDetails }}</span>
                </dd>
              </div>
              <div class="flex items-start gap-3">
                <UIcon
                  name="i-lucide-clock"
                  class="mt-0.5 size-4 shrink-0 text-dimmed"
                />
                <dd class="text-toned">
                  {{ booking?.durationMinutes }} minutes
                </dd>
              </div>
              <div class="flex items-start gap-3">
                <UIcon
                  name="i-lucide-user"
                  class="mt-0.5 size-4 shrink-0 text-dimmed"
                />
                <dd class="min-w-0 text-toned">
                  <span class="block">{{ booking?.attendeeName }}</span>
                  <span class="block truncate text-[14px] text-muted">{{ booking?.attendeeEmail }}</span>
                  <span
                    v-if="booking?.additionalGuestEmails.length"
                    class="mt-1 block text-[13px] text-muted"
                  >+ {{ booking.additionalGuestEmails.length }} additional guest{{ booking.additionalGuestEmails.length === 1 ? '' : 's' }}</span>
                </dd>
              </div>
            </dl>

            <div
              v-if="booking?.additionalGuestEmails.length"
              class="mt-5 rounded-lg border border-default bg-muted px-4 py-3"
            >
              <p class="text-[12px] font-semibold uppercase tracking-[0.08em] text-dimmed">
                Additional guests
              </p>
              <ul class="mt-2 space-y-1 text-[14px] text-toned">
                <li
                  v-for="guestEmail in booking.additionalGuestEmails"
                  :key="guestEmail"
                  class="break-all"
                >
                  {{ guestEmail }}
                </li>
              </ul>
            </div>

            <div
              v-if="booking?.answers.length || booking?.notes"
              class="mt-6 border-t border-default pt-6"
            >
              <h2 class="text-[14px] font-semibold text-highlighted">
                Guest responses
              </h2>
              <dl class="mt-3 space-y-3">
                <div
                  v-for="answer in booking?.answers"
                  :key="answer.questionId"
                  class="rounded-lg border border-default bg-muted px-4 py-3"
                >
                  <dt class="text-[12px] font-semibold uppercase tracking-[0.08em] text-dimmed">
                    {{ answer.label }}
                  </dt>
                  <dd class="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-toned">
                    {{ answer.value }}
                  </dd>
                </div>
                <div
                  v-if="booking?.notes"
                  class="rounded-lg border border-default bg-muted px-4 py-3"
                >
                  <dt class="text-[12px] font-semibold uppercase tracking-[0.08em] text-dimmed">
                    Notes
                  </dt>
                  <dd class="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-toned">
                    {{ booking.notes }}
                  </dd>
                </div>
              </dl>
            </div>

            <p
              v-if="cancelled && booking?.cancellationReason"
              class="mt-5 rounded-lg border border-default bg-muted px-4 py-3 text-[14px] leading-relaxed text-muted"
            >
              Reason given: {{ booking.cancellationReason }}
            </p>
            <div
              v-if="paymentRecoveryAvailable"
              class="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4"
            >
              <p class="text-[15px] font-semibold text-highlighted">
                Completed the payment?
              </p>
              <p class="mt-1 text-[14px] leading-relaxed text-muted">
                Check the payment with the provider and restore this booking if the original time is still available.
              </p>
              <UButton
                class="mt-4"
                icon="i-lucide-refresh-cw"
                :loading="paymentCheckState === 'checking'"
                @click="checkPaymentStatus()"
              >
                Check payment
              </UButton>
              <p
                v-if="paymentCheckError"
                class="mt-2 text-[13px] text-error"
              >
                {{ paymentCheckError }}
              </p>
            </div>
          </div>

          <div
            v-if="!cancelled && !rejected && !past"
            class="border-t border-default px-6 py-6 sm:px-8"
          >
            <template v-if="!confirming">
              <div
                v-if="awaitingPayment"
                class="mb-4 rounded-xl border border-warning/30 bg-warning/5 p-4"
              >
                <p class="text-[15px] font-semibold text-highlighted">
                  {{ returningFromPayment ? 'Confirming your payment' : 'Finish payment to confirm this time' }}
                </p>
                <p class="mt-1 text-[14px] text-muted">
                  {{ returningFromPayment
                    ? paymentCheckState === 'pending'
                      ? 'Bachs is still confirming the payment. The slot remains held and you can check again safely.'
                      : paymentCheckError || 'We are securely checking the completed checkout with Bachs. This usually takes a few seconds.'
                    : 'The slot is temporarily held. No calendar event is created until payment succeeds.' }}
                </p>
                <UButton
                  v-if="!returningFromPayment && booking?.payment?.checkoutUrl"
                  :to="booking.payment.checkoutUrl"
                  external
                  size="lg"
                  icon="i-lucide-lock-keyhole"
                  class="mt-4"
                >
                  Continue secure checkout
                </UButton>
                <UButton
                  v-else-if="returningFromPayment"
                  color="neutral"
                  variant="outline"
                  size="lg"
                  icon="i-lucide-refresh-cw"
                  :loading="paymentCheckState === 'checking'"
                  class="mt-4"
                  @click="checkPaymentStatus()"
                >
                  Check payment status
                </UButton>
              </div>
              <div
                v-else-if="pendingApproval && booking?.canHostManage"
                class="mb-4 rounded-xl border border-warning/30 bg-warning/5 p-4"
              >
                <p class="text-[15px] font-semibold text-highlighted">
                  This booking needs your approval
                </p>
                <p class="mt-1 text-[14px] text-muted">
                  Approve it to notify the guests and add it to your connected calendar.
                </p>
                <div class="mt-4 flex gap-2">
                  <UButton
                    :loading="handlingRequest === 'approve'"
                    @click="handleRequest('approve')"
                  >
                    Approve booking
                  </UButton>
                  <UButton
                    color="error"
                    variant="outline"
                    :loading="handlingRequest === 'reject'"
                    @click="handleRequest('reject')"
                  >
                    Decline
                  </UButton>
                </div>
              </div>
              <p
                v-else-if="pendingApproval"
                class="mb-4 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[14px] text-toned"
              >
                The host is reviewing this request. You will receive an email when it is approved or declined.
              </p>
              <div
                class="grid gap-3"
                :class="!pendingApproval && !awaitingPayment
                  ? joinUrl ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
                  : 'sm:grid-cols-1'"
              >
                <UButton
                  v-if="joinUrl && !pendingApproval && !awaitingPayment"
                  :to="joinUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  trailing-icon="i-lucide-external-link"
                  size="lg"
                  class="justify-center rounded-full font-medium"
                >
                  Join {{ booking?.locationType === 'google_meet' ? 'Google Meet' : booking?.locationType === 'microsoft_teams' ? 'Microsoft Teams' : booking?.locationType === 'zoom' ? 'Zoom' : 'meeting' }}
                </UButton>
                <UButton
                  v-if="!pendingApproval && !awaitingPayment"
                  :to="`/api/booking/${uid}/calendar.ics`"
                  external
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-calendar-plus"
                  size="lg"
                  class="justify-center rounded-full font-medium"
                >
                  Add to calendar
                </UButton>
                <UButton
                  v-if="!pendingApproval && !awaitingPayment"
                  :to="`${booking?.bookingPath}?reschedule=${encodeURIComponent(uid)}`"
                  size="lg"
                  class="rounded-full font-medium"
                >
                  Move to another time
                </UButton>
                <UButton
                  color="neutral"
                  variant="outline"
                  size="lg"
                  class="rounded-full font-medium"
                  @click="confirming = true"
                >
                  Cancel booking
                </UButton>
              </div>
            </template>

            <template v-else>
              <p class="text-[16px] font-medium text-highlighted">
                Cancel this booking?
              </p>
              <p class="mt-1 text-[14px] text-muted">
                {{ booking?.hostName }} will be told, and the time is freed up.
              </p>

              <UTextarea
                v-model="reason"
                :rows="2"
                :maxlength="500"
                placeholder="Reason (optional)"
                class="mt-4 w-full"
              />

              <p
                v-if="cancelError"
                class="mt-3 rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[14px] text-error"
                role="alert"
              >
                {{ cancelError }}
              </p>

              <div class="mt-4 flex flex-col gap-3 sm:flex-row">
                <UButton
                  color="error"
                  size="lg"
                  :loading="cancelling"
                  class="justify-center rounded-full font-medium sm:flex-1"
                  @click="cancel"
                >
                  Yes, cancel it
                </UButton>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="lg"
                  class="justify-center rounded-full font-medium sm:flex-1"
                  @click="confirming = false"
                >
                  Keep it
                </UButton>
              </div>
            </template>
          </div>

          <div
            v-else-if="cancelled || rejected"
            class="border-t border-default px-6 py-6 sm:px-8"
          >
            <UButton
              :to="`/${booking?.hostUsername}`"
              size="lg"
              block
              class="rounded-full font-medium"
            >
              Book another time
            </UButton>
          </div>
        </div>
      </div>
    </main>

    <footer
      v-if="!signedIn"
      class="px-5 pb-10 pt-6 text-center text-xs text-dimmed"
    >
      Scheduling by
      <NuxtLink
        to="/"
        class="underline underline-offset-4 transition-colors hover:text-muted"
      >Schedra</NuxtLink>
    </footer>
  </div>
</template>
