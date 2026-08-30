<script setup lang="ts">
import {
  PERSONAL_PRO_PLAN,
  TEAM_PLAN,
  formatUsd,
  seatPriceCents,
  type BillingInterval,
  type CollectionCurrency
} from '#shared/billing'
import { apiErrorMessage, personalBillingApi } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Plan & billing', robots: 'noindex, nofollow' })

const feedback = useFeedback()
const interval = ref<BillingInterval>('yearly')
const currency = ref<CollectionCurrency>('USD')
const checkingOut = ref(false)
const cancelling = ref(false)
const cancelOpen = ref(false)
const { data, status, error, refresh } = await useLazyFetch(personalBillingApi.summaryEndpoint)
const { data: teamList } = await useTeams()

const entitlement = computed(() => data.value?.entitlement)
const priceCents = computed(() => interval.value === 'yearly'
  ? PERSONAL_PRO_PLAN.yearlyCents
  : PERSONAL_PRO_PLAN.monthlyCents)
const periodLabel = computed(() => interval.value === 'yearly' ? 'year' : 'month')
const teamPriceCents = computed(() => seatPriceCents(interval.value))
const coveredTeam = computed(() => teamList.value.items.find(team =>
  team.id === entitlement.value?.teamCoverage?.organizationId
))
const managedTeam = computed(() => teamList.value.items.find(team => team.role === 'owner'))
const teamDestination = computed(() => {
  const team = coveredTeam.value?.role === 'owner'
    ? coveredTeam.value
    : (managedTeam.value ?? coveredTeam.value)
  return team?.role === 'owner' ? `/t/${team.slug}/billing` : team ? `/t/${team.slug}` : '/t/new'
})
const teamActionLabel = computed(() => {
  if (coveredTeam.value?.role === 'owner' || managedTeam.value) return 'Manage a Team plan'
  if (coveredTeam.value) return 'View your Team'
  return 'Start a Team'
})

async function checkout() {
  checkingOut.value = true
  try {
    const result = await personalBillingApi.checkout({
      interval: interval.value,
      currency: currency.value,
      requestId: crypto.randomUUID()
    })
    await navigateTo(result.checkoutUrl, { external: true })
  } catch (failure) {
    feedback.error({ title: 'Could not open checkout', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    checkingOut.value = false
  }
}

async function cancelPlan() {
  cancelling.value = true
  try {
    await personalBillingApi.cancel()
    cancelOpen.value = false
    await refresh()
    await refreshNuxtData('current-user')
    feedback.success({ title: 'Cancellation scheduled', description: 'Personal Pro stays active through the paid period.' })
  } catch (failure) {
    feedback.error({ title: 'Could not cancel the plan', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    cancelling.value = false
  }
}

function formatDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—'
}
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Plan & billing"
      description="Compare your personal and Team options. A paid Team seat already includes Personal Pro."
    />

    <AsyncErrorState
      v-if="error && !data"
      title="Could not load billing"
      description="No changes were made to your plan."
      :retrying="status === 'pending'"
      @retry="refresh"
    />
    <ListLoadingSkeleton
      v-else-if="status === 'pending' && !data"
      label="Loading plan and billing"
    />
    <template v-else>
      <div class="flex justify-start sm:justify-end">
        <div
          class="inline-flex rounded-full border border-default bg-muted p-1"
          aria-label="Billing period"
        >
          <button
            v-for="option in (['yearly', 'monthly'] as const)"
            :key="option"
            type="button"
            class="rounded-full px-3 py-1.5 text-sm font-medium"
            :class="interval === option ? 'bg-primary text-inverted' : 'text-muted'"
            @click="interval = option"
          >
            {{ option === 'yearly' ? 'Yearly' : 'Monthly' }}
          </button>
        </div>
      </div>

      <section class="grid gap-5 lg:grid-cols-3">
        <article class="flex flex-col rounded-2xl border border-default bg-default p-6">
          <div class="flex items-center justify-between gap-3">
            <p class="eyebrow text-muted">
              Personal Free
            </p>
            <UBadge
              v-if="!entitlement?.isPro"
              color="success"
              variant="subtle"
            >
              Current
            </UBadge>
          </div>
          <h2 class="mt-4 font-editorial text-4xl text-highlighted">
            $0
            <span class="font-sans text-sm text-muted">forever</span>
          </h2>
          <p class="mt-3 text-sm text-muted">
            Complete personal scheduling without an artificial workflow limit.
          </p>
          <ul class="mt-6 flex-1 space-y-3 text-sm text-highlighted">
            <li
              v-for="feature in ['Unlimited event types', 'Unlimited workflows and routing forms', 'Core booking analytics', 'Calendar and video integrations']"
              :key="feature"
              class="flex gap-2"
            >
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-4 shrink-0 text-success"
              />
              {{ feature }}
            </li>
          </ul>
          <UButton
            class="mt-7 justify-center"
            color="neutral"
            variant="soft"
            disabled
          >
            Always included
          </UButton>
        </article>

        <article class="flex flex-col rounded-2xl border-2 border-primary bg-default p-6">
          <div class="flex items-center justify-between gap-3">
            <p class="eyebrow text-primary">
              Personal Pro
            </p>
            <UBadge
              v-if="entitlement?.isPro"
              color="success"
              variant="subtle"
            >
              {{ entitlement.teamCoverage ? 'Included with Team' : 'Current' }}
            </UBadge>
          </div>
          <h2 class="mt-4 font-editorial text-4xl text-highlighted">
            {{ formatUsd(priceCents) }}
            <span class="font-sans text-sm text-muted">/ {{ periodLabel }}</span>
          </h2>
          <p class="mt-3 text-sm text-muted">
            Build a polished personal brand and understand your booking revenue.
          </p>
          <ul class="mt-6 flex-1 space-y-3 text-sm text-highlighted">
            <li
              v-for="feature in ['Custom logo, colours and page theme', 'Remove Schedra branding', 'Revenue analytics and CSV exports', 'Lower paid-booking fee']"
              :key="feature"
              class="flex gap-2"
            >
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-4 shrink-0 text-primary"
              />
              {{ feature }}
            </li>
          </ul>
          <template v-if="!entitlement?.isPro">
            <UFormField
              label="Pay with"
              class="mt-7"
            >
              <USelect
                v-model="currency"
                :items="[{ label: 'Card in USD', value: 'USD' }, { label: 'Bank transfer in NGN', value: 'NGN' }]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UButton
              class="mt-3 justify-center"
              size="lg"
              :loading="checkingOut"
              :disabled="!data?.configured"
              @click="checkout"
            >
              Upgrade to Personal Pro
            </UButton>
            <p
              v-if="!data?.configured"
              class="mt-3 text-sm text-warning"
            >
              Checkout is not configured in this environment yet.
            </p>
          </template>
          <UButton
            v-else
            class="mt-7 justify-center"
            disabled
          >
            Personal Pro active
          </UButton>
        </article>

        <article class="flex flex-col rounded-2xl border border-default bg-default p-6">
          <div class="flex items-center justify-between gap-3">
            <p class="eyebrow text-muted">
              Team
            </p>
            <UBadge
              v-if="entitlement?.teamCoverage"
              color="success"
              variant="subtle"
            >
              Current
            </UBadge>
          </div>
          <h2 class="mt-4 font-editorial text-4xl text-highlighted">
            {{ formatUsd(teamPriceCents) }}
            <span class="font-sans text-sm text-muted">/ member / {{ periodLabel }}</span>
          </h2>
          <p class="mt-3 text-sm text-muted">
            Coordinate scheduling across a team. Every paid member also gets Personal Pro.
          </p>
          <ul class="mt-6 flex-1 space-y-3 text-sm text-highlighted">
            <li
              v-for="feature in ['Everything in Personal Pro for every member', 'Shared team event types', 'Role-based team administration', `${TEAM_PLAN.trialDays}-day Team trial`]"
              :key="feature"
              class="flex gap-2"
            >
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-4 shrink-0 text-success"
              />
              {{ feature }}
            </li>
          </ul>
          <UButton
            class="mt-7 justify-center"
            color="neutral"
            variant="outline"
            :to="teamDestination"
          >
            {{ teamActionLabel }}
          </UButton>
        </article>
      </section>

      <section class="rounded-2xl border border-default bg-default p-6">
        <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              Current plan
            </h2>
            <dl class="mt-5 space-y-4 text-sm">
              <div>
                <dt class="text-muted">
                  Plan
                </dt><dd class="mt-1 font-medium text-highlighted">
                  {{ entitlement?.teamCoverage ? `Personal Pro via ${entitlement.teamCoverage.name}` : entitlement?.isPro ? 'Personal Pro' : 'Personal Free' }}
                </dd>
              </div>
              <div v-if="entitlement?.isPro">
                <dt class="text-muted">
                  Access through
                </dt><dd class="mt-1 font-medium text-highlighted">
                  {{ formatDate(entitlement.currentPeriodEnd) }}
                </dd>
              </div>
              <div v-if="entitlement?.isPro">
                <dt class="text-muted">
                  Renewal
                </dt><dd class="mt-1 font-medium text-highlighted">
                  {{ entitlement.teamCoverage ? 'Included while your paid Team seat is active' : entitlement.autoRenews ? 'Automatic' : 'Manual or cancelled' }}
                </dd>
              </div>
            </dl>
            <p
              v-if="entitlement?.source === 'personal_and_team'"
              class="mt-5 max-w-2xl text-sm text-muted"
            >
              Your Team now includes Pro. Your separate Personal Pro term remains available until {{ formatDate(entitlement.personalCurrentPeriodEnd) }}, but it will not be restarted automatically if Team coverage ends.
            </p>
          </div>
          <UButton
            v-if="entitlement?.isPro && entitlement.autoRenews"
            color="neutral"
            variant="outline"
            @click="cancelOpen = true"
          >
            {{ entitlement.teamCoverage ? 'Stop separate Pro renewal' : 'Cancel renewal' }}
          </UButton>
        </div>
      </section>

      <section
        v-if="data?.invoices.length"
        class="overflow-hidden rounded-xl border border-default bg-default"
      >
        <div class="border-b border-default px-6 py-5">
          <h2 class="font-semibold text-highlighted">
            Billing history
          </h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-160 text-left text-sm">
            <thead class="bg-muted text-muted">
              <tr>
                <th class="px-6 py-3">
                  Date
                </th><th class="px-6 py-3">
                  Plan
                </th><th class="px-6 py-3">
                  Amount
                </th><th class="px-6 py-3">
                  Status
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="invoice in data.invoices"
                :key="invoice.id"
              >
                <td class="px-6 py-4 text-highlighted">
                  {{ formatDate(invoice.createdAt) }}
                </td>
                <td class="px-6 py-4 capitalize text-highlighted">
                  {{ invoice.interval }}
                </td>
                <td class="px-6 py-4 text-highlighted">
                  {{ formatUsd(invoice.amountCents) }} USD
                </td>
                <td class="px-6 py-4">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    class="capitalize"
                  >
                    {{ invoice.status }}
                  </UBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <UModal
      v-model:open="cancelOpen"
      title="Cancel Personal Pro renewal?"
      description="Your Pro features remain available through the paid period."
    >
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="cancelling"
              @click="cancelOpen = false"
            >
              Keep Pro
            </UButton>
          </template>
          <template #actions>
            <UButton
              color="error"
              :loading="cancelling"
              @click="cancelPlan"
            >
              Cancel renewal
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>
  </div>
</template>
