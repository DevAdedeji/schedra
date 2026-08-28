<script setup lang="ts">
import { apiErrorMessage, paymentsApi, type PaymentAccountSummary } from '~/services/schedra-api'

const props = defineProps<{ teamSlug?: string }>()
const endpoint = computed(() => props.teamSlug
  ? paymentsApi.teamEndpoint(props.teamSlug)
  : paymentsApi.endpoint)
const route = useRoute()
const toast = useToast()

const { data, status, error, refresh } = await useFetch<PaymentAccountSummary>(endpoint)
const starting = ref(false)

const statusCopy = computed(() => ({
  not_started: ['Set up payouts', 'Connect a payout account before adding a price to an event.'],
  onboarding: ['Finish setup', 'Bachs still needs a few business or identity details.'],
  pending_review: ['Under review', 'Your information was submitted. We will enable paid bookings when Bachs approves payouts.'],
  active: ['Ready for paid bookings', 'Guests can pay securely and your share is routed to this payout account.'],
  restricted: ['Action required', 'Update your payment account before accepting new paid bookings.'],
  disabled: ['Payments unavailable', 'This payout account is disabled. Contact support if this was unexpected.']
} as const)[data.value?.status ?? 'not_started'])

async function start() {
  starting.value = true
  try {
    const link = await paymentsApi.start(props.teamSlug)
    window.location.assign(link.url)
  } catch (failure) {
    toast.add({ title: 'Could not open payment setup', description: apiErrorMessage(failure, 'Try again in a moment.'), color: 'error' })
  } finally {
    starting.value = false
  }
}

onMounted(async () => {
  if (route.query.payments === 'returned') {
    await refresh()
    toast.add({
      title: data.value?.ready ? 'Payments are ready' : 'Payment details received',
      description: data.value?.ready ? 'You can now charge for bookings.' : 'Your payout account may still be under review.',
      color: data.value?.ready ? 'success' : 'neutral'
    })
  } else if (route.query.payments === 'refresh') {
    await start()
  }
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Payments"
      description="Accept payment when a guest books. Schedra handles checkout and sends your share to your connected payout account."
    />

    <section class="overflow-hidden rounded-2xl border border-default bg-default">
      <div class="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-7">
        <div class="flex min-w-0 gap-4">
          <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon
              name="i-lucide-wallet-cards"
              class="size-5"
            />
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold text-highlighted">
                Payout account
              </h2>
              <UBadge
                :color="data?.ready ? 'success' : data?.status === 'pending_review' ? 'warning' : 'neutral'"
                variant="subtle"
              >
                {{ statusCopy[0] }}
              </UBadge>
            </div>
            <p class="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              {{ statusCopy[1] }}
            </p>
          </div>
        </div>
        <UButton
          v-if="!data?.ready"
          :loading="starting"
          icon="i-lucide-external-link"
          size="lg"
          class="min-h-11 shrink-0"
          @click="start"
        >
          {{ data?.configured ? 'Continue setup' : 'Set up payouts' }}
        </UButton>
      </div>
      <div class="surface-secondary grid gap-px border-t border-default sm:grid-cols-2 lg:grid-cols-4">
        <div class="p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Guest checkout
          </p>
          <p class="mt-2 text-sm text-toned">
            The listed event price is what the guest pays.
          </p>
        </div>
        <div class="p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Schedra fee
          </p>
          <p class="mt-2 text-sm text-toned">
            {{ ((data?.platformFeeBps ?? 500) / 100).toFixed(2).replace(/\.00$/, '') }}% per paid booking.
          </p>
        </div>
        <div class="p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Bachs processing
          </p>
          <p class="mt-2 text-sm text-toned">
            Deducted from the charge at the rate for the payment method used.
          </p>
        </div>
        <div class="p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Withdrawals
          </p>
          <p class="mt-2 text-sm text-toned">
            Bachs applies the payout account's withdrawal fee when funds are withdrawn.
          </p>
        </div>
      </div>
    </section>

    <AsyncErrorState
      v-if="error"
      title="Could not check your payout account"
      description="Your existing setup is safe. Try the health check again."
      :retrying="status === 'pending'"
      @retry="refresh"
    />
  </div>
</template>
