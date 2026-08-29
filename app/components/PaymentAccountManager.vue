<script setup lang="ts">
import { formatMoney } from '#shared/payments'
import {
  apiErrorMessage,
  paymentsApi,
  type PaymentAccountSummary,
  type PaymentMoneyTotal,
  type PaymentSummary
} from '~/services/schedra-api'

const props = defineProps<{ teamSlug?: string }>()
const endpoint = computed(() => props.teamSlug
  ? paymentsApi.teamEndpoint(props.teamSlug)
  : paymentsApi.endpoint)
const route = useRoute()
const toast = useToast()

const { data, status, error, refresh } = await useFetch<PaymentAccountSummary>(endpoint)
const summaryEndpoint = computed(() => paymentsApi.summaryEndpoint(props.teamSlug))
const {
  data: summary,
  status: summaryStatus,
  error: summaryError,
  refresh: refreshSummary
} = await useLazyFetch<PaymentSummary>(summaryEndpoint)
const starting = ref(false)

function money(totals: PaymentMoneyTotal[]) {
  return totals.map(total => formatMoney(total.amountCents, total.currency))
}

function providerMoney(totals: PaymentMoneyTotal[]) {
  const values = money(totals)
  if (values.length) return values
  const currencies = new Set(summary.value?.collected.map(total => total.currency) ?? [])
  return [...currencies].sort().map(currency => formatMoney(0, currency))
}

const statusCopy = computed(() => ({
  not_started: ['Set up payouts', 'Complete Bachs’ secure setup once, including the bank account for your payouts.'],
  onboarding: ['Finish setup', 'Continue the secure Bachs flow to complete identity and payout-account details.'],
  pending_review: ['Under review', 'Your information was submitted. We will enable paid bookings when Bachs approves payouts.'],
  active: ['Ready for paid bookings', 'Guests can pay securely. Bachs settles your share and routes it to the bank account saved during setup.'],
  restricted: ['Action required', 'Update your payment account before accepting new paid bookings.'],
  disabled: ['Payments unavailable', 'This payout account is disabled. Contact support if this was unexpected.']
} as const)[data.value?.status ?? 'not_started'])

const actionLabel = computed(() => data.value?.ready
  ? 'Manage in Bachs'
  : data.value?.configured ? 'Continue setup' : 'Set up payouts')

function takeNextAction() {
  void start()
}

async function start() {
  starting.value = true
  const setupWindow = window.open('about:blank', '_blank')
  if (setupWindow) setupWindow.opener = null
  try {
    const link = await paymentsApi.start(props.teamSlug)
    if (setupWindow) setupWindow.location.replace(link.url)
    else window.location.assign(link.url)
  } catch (failure) {
    setupWindow?.close()
    toast.add({ title: 'Could not open payment setup', description: apiErrorMessage(failure, 'Try again in a moment.'), color: 'error' })
  } finally {
    starting.value = false
  }
}

async function checkSetupOnReturn() {
  if (document.visibilityState !== 'visible' || !data.value?.configured || data.value.ready) return
  await refresh()
}

onMounted(async () => {
  document.addEventListener('visibilitychange', checkSetupOnReturn)
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

onBeforeUnmount(() => document.removeEventListener('visibilitychange', checkSetupOnReturn))
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Payments"
      description="Accept payment when a guest books. Schedra handles checkout while Bachs settles and pays out your share."
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
          v-if="data?.ready || data?.nextAction !== 'none'"
          :loading="starting"
          icon="i-lucide-external-link"
          class="mobile-compact-action h-9 min-h-9 shrink-0 text-center"
          @click="takeNextAction"
        >
          {{ actionLabel }}
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
            Bachs routes settled funds to the bank account you added during its secure setup.
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

    <section
      class="overflow-hidden rounded-2xl border border-default bg-default"
      aria-labelledby="payment-summary-title"
    >
      <div class="flex flex-col gap-2 border-b border-default p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2
            id="payment-summary-title"
            class="text-base font-semibold text-highlighted"
          >
            Payment summary
          </h2>
          <p class="mt-1 text-sm text-muted">
            Follow paid bookings from collection through settlement and delivery to your bank.
          </p>
        </div>
        <UButton
          v-if="summary?.providerStatus === 'unavailable'"
          label="Try again"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="summaryStatus === 'pending'"
          @click="() => refreshSummary()"
        />
      </div>

      <div
        v-if="summaryStatus === 'pending' && !summary"
        class="grid gap-px surface-secondary sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Loading payment summary"
      >
        <div
          v-for="index in 4"
          :key="index"
          class="space-y-3 bg-default p-5 sm:p-6"
        >
          <USkeleton class="h-3 w-24" />
          <USkeleton class="h-7 w-32" />
          <USkeleton class="h-3 w-40 max-w-full" />
        </div>
      </div>
      <AsyncErrorState
        v-else-if="summaryError && !summary"
        title="Could not load payment totals"
        description="Your payment records are safe. Try loading the summary again."
        :retrying="summaryStatus === 'pending'"
        @retry="refreshSummary"
      />
      <div
        v-else
        class="grid gap-px surface-secondary sm:grid-cols-2 lg:grid-cols-4"
      >
        <div class="bg-default p-5 sm:p-6">
          <div class="flex items-center gap-2 text-muted">
            <UIcon
              name="i-lucide-circle-dollar-sign"
              class="size-4"
            />
            <p class="text-xs font-medium uppercase tracking-wide">
              Total collected
            </p>
          </div>
          <div class="mt-3 space-y-1 text-xl font-semibold tabular-nums text-highlighted">
            <p
              v-for="value in money(summary?.collected ?? [])"
              :key="value"
            >
              {{ value }}
            </p>
            <p v-if="!summary?.collected.length">
              —
            </p>
          </div>
          <p class="mt-2 text-xs text-muted">
            Successful paid bookings at their listed price.
          </p>
        </div>
        <div class="bg-default p-5 sm:p-6">
          <div class="flex items-center gap-2 text-muted">
            <UIcon
              name="i-lucide-clock-3"
              class="size-4"
            />
            <p class="text-xs font-medium uppercase tracking-wide">
              Pending settlement
            </p>
          </div>
          <div class="mt-3 space-y-1 text-xl font-semibold tabular-nums text-highlighted">
            <template v-if="summary?.providerStatus === 'available'">
              <p
                v-for="value in providerMoney(summary.pending)"
                :key="value"
              >
                {{ value }}
              </p>
              <p v-if="!providerMoney(summary.pending).length">
                —
              </p>
            </template>
            <p v-else>
              Unavailable
            </p>
          </div>
          <p class="mt-2 text-xs text-muted">
            {{ summary?.providerStatus === 'available' ? 'Customer payments Bachs is still settling.' : 'Reconnect or retry the Bachs balance check.' }}
          </p>
        </div>
        <div class="bg-default p-5 sm:p-6">
          <div class="flex items-center gap-2 text-muted">
            <UIcon
              name="i-lucide-wallet"
              class="size-4"
            />
            <p class="text-xs font-medium uppercase tracking-wide">
              Awaiting bank payout
            </p>
          </div>
          <div class="mt-3 space-y-1 text-xl font-semibold tabular-nums text-highlighted">
            <template v-if="summary?.providerStatus === 'available'">
              <p
                v-for="value in providerMoney(summary.available)"
                :key="value"
              >
                {{ value }}
              </p>
              <p v-if="!providerMoney(summary.available).length">
                —
              </p>
            </template>
            <p v-else>
              Unavailable
            </p>
          </div>
          <p class="mt-2 text-xs text-muted">
            Settled funds waiting for Bachs to complete the bank payout.
          </p>
        </div>
        <div class="bg-default p-5 sm:p-6">
          <div class="flex items-center gap-2 text-muted">
            <UIcon
              name="i-lucide-banknote-arrow-up"
              class="size-4"
            />
            <p class="text-xs font-medium uppercase tracking-wide">
              Paid to your bank
            </p>
          </div>
          <div class="mt-3 space-y-1 text-xl font-semibold tabular-nums text-highlighted">
            <template v-if="summary?.providerStatus === 'available'">
              <p
                v-for="value in providerMoney(summary.withdrawn)"
                :key="value"
              >
                {{ value }}
              </p>
              <p v-if="!providerMoney(summary.withdrawn).length">
                —
              </p>
            </template>
            <p v-else>
              Unavailable
            </p>
          </div>
          <p class="mt-2 text-xs text-muted">
            Completed payouts Bachs has delivered to the bank account saved during setup.
          </p>
        </div>
      </div>
    </section>

    <PaymentActivityList :team-slug="teamSlug" />
  </div>
</template>
