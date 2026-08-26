<script setup lang="ts">
import {
  billingIntervals,
  billingCheckoutReason,
  collectionCurrencies,
  collectionMethodFor,
  formatUsd,
  invoiceTotalCents,
  type BillingInterval,
  type CollectionCurrency
} from '#shared/billing'
import { apiErrorMessage, billingApi, type TeamBillingResponse } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Team billing', robots: 'noindex, nofollow' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const feedback = useFeedback()

const { data, refresh, status, error: loadFailure }
  = await useLazyFetch<TeamBillingResponse>(() => billingApi.summaryEndpoint(slug.value))

const entitlement = computed(() => data.value?.entitlement)
const invoices = computed(() => data.value?.invoices ?? [])
const seatBilling = computed(() => data.value?.seatBilling)
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const seatMismatch = computed(() => Boolean(
  entitlement.value
  && (seatBilling.value?.billedSeats ?? 0) !== entitlement.value.seatsUsed
))
const automaticSeatBilling = computed(() => seatBilling.value?.collectionMethod === 'charge_automatically')
const seatSyncActive = computed(() => ['pending', 'processing'].includes(seatBilling.value?.syncStatus ?? ''))
const checkoutReason = computed(() => {
  if (!entitlement.value || !seatBilling.value) return null
  return billingCheckoutReason(
    entitlement.value.status,
    seatBilling.value.collectionMethod,
    seatMismatch.value
  )
})
const checkoutLabel = computed(() => {
  if (checkoutReason.value === 'restart') return 'Start a new subscription'
  if (checkoutReason.value === 'manual_seat_change') return 'Update billing for current members'
  if (checkoutReason.value === 'manual_renewal') return 'Pay outstanding invoice'
  return 'Pay and activate'
})

const interval = ref<BillingInterval>('yearly')
const currency = ref<CollectionCurrency>('USD')
const starting = ref(false)
const retryingSeatSync = ref(false)

watch(entitlement, (value) => {
  if (value) interval.value = value.interval
}, { immediate: true })

watch(() => seatBilling.value?.collectionCurrency, (value) => {
  if (value) currency.value = value
}, { immediate: true })

const intervalOptions = billingIntervals.map(value => ({
  label: value === 'yearly' ? 'Yearly — two months free' : 'Monthly',
  value
}))
const currencyOptions = collectionCurrencies.map(value => ({
  label: value === 'NGN' ? 'Pay in NGN (bank transfer)' : 'Pay in USD (card)',
  value
}))

// USD by card becomes a Bachs subscription that renews itself. NGN is bank
// transfer, which nothing can charge for us, so each period is a fresh invoice.
const willAutoRenew = computed(() => collectionMethodFor(currency.value) === 'charge_automatically')

const seats = computed(() => entitlement.value?.seatsUsed ?? 0)
const total = computed(() => invoiceTotalCents(seats.value, interval.value))

// Bachs confirms payment by webhook; this redirect only tells us to re-read.
const paidJustNow = computed(() => route.query.paid === '1')

watch(paidJustNow, async (paid) => {
  if (!paid) return
  await refresh()
}, { immediate: true })

async function startCheckout() {
  if (starting.value || !checkoutReason.value) return
  starting.value = true

  try {
    const session = await billingApi.checkout(slug.value, {
      interval: interval.value,
      currency: currency.value
    })
    // Leaving the app entirely, so a full navigation rather than a route push.
    window.location.href = session.checkoutUrl
  } catch (failure) {
    feedback.error({
      title: 'Could not start checkout',
      description: apiErrorMessage(failure, 'Please try again.')
    })
    starting.value = false
  }
}

async function retrySeatSync() {
  if (retryingSeatSync.value) return
  retryingSeatSync.value = true
  try {
    await billingApi.syncSeats(slug.value)
    feedback.success({
      title: 'Seat billing queued',
      description: 'We are checking the subscription against your active members now.'
    })
    await new Promise(resolve => setTimeout(resolve, 1500))
    await refresh()
  } catch (failure) {
    feedback.error({
      title: 'Could not retry seat billing',
      description: apiErrorMessage(failure, 'Please try again shortly.')
    })
  } finally {
    retryingSeatSync.value = false
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const statusColor: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  paid: 'success',
  pending: 'warning',
  failed: 'error',
  expired: 'neutral'
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Billing"
      description="Members who have joined are what you pay for. Pending invitations are free."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          :to="`/t/${slug}/settings`"
        >
          Settings
        </UButton>
      </template>
    </PageHeader>

    <div
      v-if="paidJustNow"
      class="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3"
      role="status"
    >
      <UIcon
        name="i-lucide-circle-check"
        class="size-4 shrink-0 text-success"
      />
      <p class="text-[13px] text-muted">
        Payment received. If the status below still says pending, it will settle within a moment —
        we confirm from Bachs directly, never from this redirect.
      </p>
    </div>

    <AsyncErrorState
      v-if="loadFailure && !data"
      title="Could not load billing"
      description="Only an owner can view this."
      @retry="refresh"
    />

    <ListLoadingSkeleton
      v-else-if="initialLoading"
      label="Loading billing"
    />

    <template v-else-if="entitlement">
      <div
        v-if="!data?.configured"
        class="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3"
      >
        <UIcon
          name="i-lucide-triangle-alert"
          class="mt-0.5 size-4 shrink-0 text-warning"
        />
        <p class="text-[13px] leading-relaxed text-muted">
          Billing is not configured on this environment, so checkout is unavailable.
          Set <code class="text-[12px]">BACHS_SECRET_KEY</code> and
          <code class="text-[12px]">BACHS_WEBHOOK_SECRET</code> to enable it.
        </p>
      </div>

      <div
        v-if="entitlement.status === 'active' && automaticSeatBilling && (seatMismatch || seatSyncActive || seatBilling?.syncStatus === 'failed')"
        class="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
        :class="seatBilling?.syncStatus === 'failed' ? 'border-error/30 bg-error/5' : 'border-info/30 bg-info/5'"
        :role="seatBilling?.syncStatus === 'failed' ? 'alert' : 'status'"
      >
        <UIcon
          :name="seatBilling?.syncStatus === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-refresh-cw'"
          class="size-4 shrink-0"
          :class="seatBilling?.syncStatus === 'failed' ? 'text-error' : 'text-info'"
        />
        <p class="min-w-0 flex-1 text-[13px] text-muted">
          <template v-if="seatBilling?.syncStatus === 'failed'">
            We could not update the subscription for {{ entitlement.seatsUsed }} active
            {{ entitlement.seatsUsed === 1 ? 'member' : 'members' }}. No change has been hidden;
            retry after checking the Bachs connection.
          </template>
          <template v-else>
            Updating the subscription to {{ entitlement.seatsUsed }}
            {{ entitlement.seatsUsed === 1 ? 'seat' : 'seats' }}. Bachs will charge only the
            prorated difference for the time remaining in this billing period.
          </template>
        </p>
        <UButton
          v-if="seatBilling?.syncStatus === 'failed'"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="retryingSeatSync"
          @click="retrySeatSync"
        >
          Try again
        </UButton>
      </div>

      <div
        v-if="entitlement.status === 'active' && !automaticSeatBilling && seatMismatch"
        class="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3"
        role="status"
      >
        <UIcon
          name="i-lucide-triangle-alert"
          class="mt-0.5 size-4 shrink-0 text-warning"
        />
        <p class="text-[13px] leading-relaxed text-muted">
          This team now has {{ entitlement.seatsUsed }} active members, but the last paid invoice
          covered {{ seatBilling?.billedSeats ?? 0 }}. Bank transfers cannot be charged automatically;
          start checkout below to update the paid term for the current team size.
        </p>
      </div>

      <section class="overflow-hidden rounded-xl border border-default bg-default">
        <header class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-5 py-4">
          <h2 class="text-[14px] font-semibold text-highlighted">
            Current plan
          </h2>
          <UBadge
            :color="entitlement.status === 'active' ? 'success' : entitlement.status === 'trialing' ? 'info' : 'error'"
            variant="subtle"
          >
            {{ entitlement.status.replace('_', ' ') }}
          </UBadge>
        </header>

        <div class="space-y-5 px-5 py-5">
          <p class="text-[13px] text-muted">
            <template v-if="entitlement.status === 'trialing'">
              {{ entitlement.daysLeftInTrial }} days left in your trial. Pay any time to keep the team running.
            </template>
            <template v-else-if="entitlement.status === 'past_due'">
              A payment failed. It is being retried automatically and the team keeps working meanwhile.
            </template>
            <template v-else-if="entitlement.status === 'unpaid'">
              Payment retries are exhausted, so the team is read-only. Paying below restores it immediately.
            </template>
            <template v-else-if="entitlement.readOnly">
              This team is read-only. Team booking pages are not taking new bookings until an invoice is paid.
            </template>
            <template v-else-if="entitlement.currentPeriodEnd">
              {{ entitlement.autoRenews ? 'Renews' : 'Paid through' }}
              {{ formatDate(entitlement.currentPeriodEnd) }}.
            </template>
          </p>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Billing period">
              <USelectMenu
                v-model="interval"
                :items="intervalOptions"
                value-key="value"
                size="lg"
                :disabled="!checkoutReason"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Pay with"
              :help="willAutoRenew
                ? 'Renews automatically on the saved card each period.'
                : 'Bank transfer cannot be charged automatically, so you will get an invoice each period.'"
            >
              <USelectMenu
                v-model="currency"
                :items="currencyOptions"
                value-key="value"
                size="lg"
                :disabled="!checkoutReason"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="rounded-xl border border-default bg-muted/50 px-4 py-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-[13px] text-muted">
                {{ seats }} {{ seats === 1 ? 'member' : 'members' }}
              </p>
              <p class="text-[20px] font-semibold text-highlighted">
                {{ formatUsd(total) }}
                <span class="text-[13px] font-normal text-muted">/{{ interval === 'yearly' ? 'year' : 'month' }}</span>
              </p>
            </div>
            <p
              v-if="seatBilling?.billedSeats != null"
              class="mt-2 text-[11px] text-muted"
            >
              Current subscription: {{ seatBilling.billedSeats }}
              {{ seatBilling.billedSeats === 1 ? 'seat' : 'seats' }}.
              Pending invitations remain free until accepted.
            </p>
          </div>

          <UButton
            v-if="checkoutReason"
            size="lg"
            block
            :loading="starting"
            :disabled="!data?.configured"
            @click="startCheckout"
          >
            {{ checkoutLabel }}
          </UButton>

          <div
            v-else-if="entitlement.autoRenews"
            class="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3"
            role="status"
          >
            <UIcon
              name="i-lucide-circle-check"
              class="mt-0.5 size-4 shrink-0 text-success"
            />
            <p class="text-[13px] leading-relaxed text-muted">
              No payment action is needed. This subscription will renew automatically
              <template v-if="entitlement.currentPeriodEnd">
                on {{ formatDate(entitlement.currentPeriodEnd) }}
              </template>.
            </p>
          </div>

          <div
            v-else-if="automaticSeatBilling && ['past_due', 'unpaid', 'paused'].includes(entitlement.status)"
            class="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3"
            role="status"
          >
            <UIcon
              name="i-lucide-mail-warning"
              class="mt-0.5 size-4 shrink-0 text-warning"
            />
            <p class="text-[13px] leading-relaxed text-muted">
              Bachs is managing this payment issue. Use the secure payment-update link sent to
              the billing email instead of starting a second subscription.
            </p>
          </div>
        </div>
      </section>

      <section class="overflow-hidden rounded-xl border border-default bg-default">
        <header class="border-b border-default px-5 py-4">
          <h2 class="text-[14px] font-semibold text-highlighted">
            Invoices
          </h2>
        </header>

        <ListEmptyState
          v-if="!invoices.length"
          icon="i-lucide-receipt"
          title="No invoices yet"
          description="Your first invoice appears here once you start a subscription."
        />

        <ul
          v-else
          class="divide-y divide-default"
        >
          <li
            v-for="invoice in invoices"
            :key="invoice.id"
            class="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5"
          >
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-medium text-highlighted">
                {{ formatUsd(invoice.amountCents) }}
                <span class="font-normal text-muted">
                  · {{ invoice.seats }} {{ invoice.seats === 1 ? 'member' : 'members' }}
                  · {{ invoice.interval }}
                </span>
              </p>
              <p class="mt-0.5 text-[11px] text-muted">
                {{ formatDate(invoice.periodStart) }} – {{ formatDate(invoice.periodEnd) }}
                <span v-if="invoice.collectionCurrency !== 'USD'"> · paid in {{ invoice.collectionCurrency }}</span>
              </p>
            </div>
            <UBadge
              :color="statusColor[invoice.status] ?? 'neutral'"
              variant="subtle"
              size="sm"
            >
              {{ invoice.status }}
            </UBadge>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
