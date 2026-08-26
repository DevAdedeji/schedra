<script setup lang="ts">
import {
  TEAM_PLAN,
  billingIntervals,
  collectionCurrencies,
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
const initialLoading = computed(() => status.value === 'pending' && !data.value)

const interval = ref<BillingInterval>('yearly')
const currency = ref<CollectionCurrency>('USD')
const starting = ref(false)

watch(entitlement, (value) => {
  if (value) interval.value = value.interval
}, { immediate: true })

const intervalOptions = billingIntervals.map(value => ({
  label: value === 'yearly' ? 'Yearly — two months free' : 'Monthly',
  value
}))
const currencyOptions = collectionCurrencies.map(value => ({
  label: value === 'NGN' ? 'Pay in NGN (bank transfer)' : 'Pay in USD (card)',
  value
}))

const seats = computed(() => entitlement.value?.seatsUsed ?? 0)
const total = computed(() => invoiceTotalCents(seats.value, interval.value))
const belowMinimum = computed(() => seats.value < TEAM_PLAN.minimumSeats)

// Bachs cannot re-charge a bank transfer, so there is no card on file and no
// silent renewal: each period is a fresh invoice the team chooses to pay.
const paidJustNow = computed(() => route.query.paid === '1')

watch(paidJustNow, async (paid) => {
  if (!paid) return
  await refresh()
}, { immediate: true })

async function startCheckout() {
  if (starting.value) return
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
            <template v-else-if="entitlement.readOnly">
              This team is read-only. Team booking pages are not taking new bookings until an invoice is paid.
            </template>
            <template v-else-if="entitlement.currentPeriodEnd">
              Paid through {{ formatDate(entitlement.currentPeriodEnd) }}.
            </template>
          </p>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Billing period">
              <USelectMenu
                v-model="interval"
                :items="intervalOptions"
                value-key="value"
                size="lg"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Pay with"
              help="Prices are always in USD. NGN settles over bank transfer."
            >
              <USelectMenu
                v-model="currency"
                :items="currencyOptions"
                value-key="value"
                size="lg"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="rounded-xl border border-default bg-muted/50 px-4 py-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-[13px] text-muted">
                {{ seats }} {{ seats === 1 ? 'member' : 'members' }}
                <span v-if="belowMinimum">
                  · billed at the {{ TEAM_PLAN.minimumSeats }}-member minimum
                </span>
              </p>
              <p class="text-[20px] font-semibold text-highlighted">
                {{ formatUsd(total) }}
                <span class="text-[13px] font-normal text-muted">/{{ interval === 'yearly' ? 'year' : 'month' }}</span>
              </p>
            </div>
          </div>

          <UButton
            size="lg"
            block
            :loading="starting"
            :disabled="!data?.configured"
            @click="startCheckout"
          >
            {{ entitlement.status === 'active' ? 'Renew now' : 'Pay and activate' }}
          </UButton>
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
