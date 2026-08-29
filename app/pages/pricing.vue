<script setup lang="ts">
import { TEAM_PLAN, formatUsd, type BillingInterval } from '#shared/billing'

definePageMeta({ layout: 'default' })

const origin = useRuntimeConfig().public.siteUrl || useRequestURL().origin
const { isSignedIn, accountDestination } = await useLandingNavigation()

// Signed in, "start a team" has to actually start one — sending them to the
// dashboard is what makes a marketing CTA feel broken.
const teamDestination = computed(() => isSignedIn.value ? '/t/new' : '/signup')
const personalCta = computed(() => isSignedIn.value ? 'Go to your dashboard' : 'Create your link')
const teamCta = computed(() => isSignedIn.value ? 'Create a team' : 'Start a team free')

const interval = ref<BillingInterval>('yearly')
const hydrated = ref(false)

onMounted(() => {
  hydrated.value = true
})

// The headline is always the amount that actually gets charged. Leading with a
// monthly-equivalent for a yearly plan reads as a $6.67 debit that never happens.
const headlineCents = computed(() => interval.value === 'yearly'
  ? TEAM_PLAN.yearlyCentsPerSeat
  : TEAM_PLAN.monthlyCentsPerSeat)

const monthlyEquivalentCents = Math.round(TEAM_PLAN.yearlyCentsPerSeat / 12)

const yearlySavingMonths = Math.round(
  12 - TEAM_PLAN.yearlyCentsPerSeat / TEAM_PLAN.monthlyCentsPerSeat
)

/**
 * One list for the whole comparison. Adding a feature is a single row. A value
 * is `true`, `false`, the literal `'soon'` for something on the way, or any
 * other string when a plan needs a number instead of a tick.
 */
type Availability = boolean | 'soon' | string

interface ComparisonRow {
  label: string
  detail?: string
  free: Availability
  team: Availability
}

const comparison: { group: string, rows: ComparisonRow[] }[] = [
  {
    group: 'Your own scheduling',
    rows: [
      { label: 'Personal booking page', free: true, team: true },
      { label: 'Event types', free: 'Unlimited', team: 'Unlimited' },
      { label: 'Weekly hours and date overrides', free: true, team: true },
      { label: 'Multiple schedules', free: '10', team: '10' },
      { label: 'Timezone-correct slots', free: true, team: true },
      { label: 'Buffers, notice and daily limits', free: true, team: true },
      { label: 'Custom booking questions', free: true, team: true },
      { label: 'Booking approvals', free: true, team: true },
      { label: 'Group events with capacity', free: true, team: true },
      { label: 'Additional guests on a booking', free: true, team: true },
      { label: 'Reminder emails', free: true, team: true },
      { label: 'Cancel and reschedule links', free: true, team: true },
      { label: 'Export your data', free: true, team: true }
    ]
  },
  {
    group: 'Automation and insights',
    rows: [
      { label: 'Email and webhook workflows', free: true, team: true },
      { label: 'Routing forms', free: true, team: true },
      { label: 'Booking analytics', free: true, team: true },
      { label: 'Paid bookings', free: true, team: true },
      { label: 'Payment and settlement activity', free: true, team: true }
    ]
  },
  {
    group: 'Scheduling together',
    rows: [
      { label: 'Shared team booking page', free: false, team: true },
      { label: 'Shared team event types', free: false, team: true },
      { label: 'Members', free: false, team: `Up to ${TEAM_PLAN.maxSeats}` },
      { label: 'Roles and permissions', free: false, team: 'Owner, admin, member' },
      {
        label: 'Round-robin assignment',
        detail: 'The free, fairest host takes the booking.',
        free: false,
        team: true
      },
      {
        label: 'Collective meetings',
        detail: 'Offered only when every required host is free.',
        free: false,
        team: true
      },
      { label: 'Per-host availability and calendars', free: false, team: true },
      { label: 'Guest rescheduling for team bookings', free: false, team: true },
      { label: 'Team bookings and activity log', free: false, team: true },
      { label: 'Ownership transfer and team archiving', free: false, team: true }
    ]
  },
  {
    group: 'Integrations and distribution',
    rows: [
      { label: 'Booking overlay for your website', free: true, team: true },
      { label: 'Google Calendar conflict checks and sync', free: true, team: true },
      { label: 'Microsoft Calendar conflict checks and sync', free: true, team: true },
      { label: 'Google Meet links', free: true, team: true },
      { label: 'Microsoft Teams links', free: true, team: true },
      { label: 'Zoom meeting links', free: true, team: true },
      { label: 'Automatic calendar-sync retries', free: true, team: true }
    ]
  },
  {
    group: 'Everywhere',
    rows: [
      { label: 'No ads and no reselling personal data', free: true, team: true },
      { label: 'Email support', free: true, team: true }
    ]
  }
]

const faqs = [
  {
    q: 'Who exactly am I paying for?',
    a: 'Only people who have actually joined a team. A pending invitation costs nothing until it is accepted, and someone you remove stops counting from that moment. There are no prepaid or empty seats.'
  },
  {
    q: 'Is my personal booking page affected?',
    a: 'No. Your own page, hours, event types and calendar integrations stay free forever, whether or not you ever join a team. Joining a team never moves or shares any of it — a team only ever sees whether you are free or busy, never what you are doing.'
  },
  {
    q: 'What happens when the trial ends?',
    a: `You get ${TEAM_PLAN.trialDays} days free with no card. If the trial ends unpaid there is a ${TEAM_PLAN.graceDays}-day grace period, after which the team goes read-only: team booking pages stop taking new bookings, but nothing is deleted. Every booking, member and export stays exactly where it is, and paying restores it immediately.`
  },
  {
    q: 'How do I pay?',
    a: 'Card in USD, or bank transfer in Nigerian naira. Prices are always quoted in USD. Because a bank transfer cannot be charged automatically, nothing renews silently — each period you get an invoice and choose to pay it.'
  },
  {
    q: 'Can I change between monthly and yearly?',
    a: 'Yes, at any renewal. Yearly works out at two months free and means one payment a year instead of twelve.'
  }
]

useSeoMeta({
  title: 'Pricing',
  description: `Schedra is free for your own booking page, forever. Team scheduling is ${formatUsd(TEAM_PLAN.monthlyCentsPerSeat)} per member each month, billed only for members who have joined.`,
  ogTitle: 'Schedra pricing',
  ogDescription: `Free for personal scheduling. ${formatUsd(TEAM_PLAN.monthlyCentsPerSeat)} per member each month for teams.`
})

useHead({
  script: [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      'name': 'Schedra',
      'url': `${origin}/pricing`,
      'description': 'Scheduling links with clear timezone handling, free for individuals and per member for teams.',
      'offers': [
        {
          '@type': 'Offer',
          'name': 'Personal',
          'price': '0',
          'priceCurrency': 'USD'
        },
        {
          '@type': 'Offer',
          'name': 'Team',
          'price': (TEAM_PLAN.monthlyCentsPerSeat / 100).toFixed(2),
          'priceCurrency': TEAM_PLAN.currency,
          'description': 'Per member, per month, billed only for members who have joined.'
        }
      ]
    })
  }]
})
</script>

<template>
  <div :data-ready="hydrated">
    <section class="border-b border-default">
      <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-28">
        <p class="eyebrow text-dimmed">
          Pricing
        </p>
        <h1 class="mt-6 max-w-[18ch] font-editorial text-[clamp(2.5rem,6vw,4rem)] leading-[1.02] tracking-[-0.02em] text-highlighted">
          Free on your own. Fair together.
        </h1>
        <p class="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-muted">
          Your own booking page costs nothing and always will. You only pay when
          a team shares one — and only for the people who actually joined.
        </p>
      </div>
    </section>

    <section class="border-b border-default bg-muted">
      <div class="mx-auto max-w-312 px-6 py-16 lg:px-10 lg:py-20">
        <!-- Sits with the cards, not up in the hero: the price above changes
             when this changes, so the control has to be next to what it moves. -->
        <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div
            class="inline-flex items-center gap-1 rounded-full border border-default bg-default p-1"
            role="group"
            aria-label="Billing period"
          >
            <button
              v-for="option in (['yearly', 'monthly'] as const)"
              :key="option"
              type="button"
              class="rounded-full px-4 py-2 text-[14px] font-medium transition-colors"
              :class="interval === option
                ? 'bg-primary text-inverted'
                : 'text-muted hover:text-highlighted'"
              :aria-pressed="interval === option"
              @click="interval = option"
            >
              {{ option === 'yearly' ? 'Yearly' : 'Monthly' }}
            </button>
          </div>

          <p
            v-if="interval === 'yearly'"
            class="text-[14px] text-muted"
          >
            {{ yearlySavingMonths }} months free, and one payment a year instead of twelve.
          </p>
        </div>

        <div class="grid gap-6 lg:grid-cols-2">
          <article class="flex flex-col rounded-2xl border border-default bg-default p-7 lg:p-9">
            <p class="eyebrow text-dimmed">
              Personal
            </p>
            <p class="mt-6 font-editorial text-[3rem] leading-none tracking-[-0.02em] text-highlighted">
              Free
            </p>
            <p class="mt-3 text-[15px] text-muted">
              Forever, for one person. No card, no expiry.
            </p>
            <p class="mt-6 max-w-[40ch] text-[16px] leading-relaxed text-muted">
              Everything you need to share a link or add booking to your website:
              flexible hours, timezone-correct slots, calendar sync and video links.
            </p>
            <UButton
              :to="accountDestination"
              prefetch
              size="xl"
              color="neutral"
              variant="outline"
              block
              class="mobile-compact-action mt-auto rounded-full text-center font-medium"
            >
              {{ personalCta }}
            </UButton>
          </article>

          <article class="relative flex flex-col rounded-2xl border-2 border-primary bg-default p-7 lg:p-9">
            <span class="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-[12px] font-semibold tracking-wide text-inverted">
              For teams
            </span>
            <p class="eyebrow text-dimmed">
              Team
            </p>
            <p class="mt-6 font-editorial text-[3rem] leading-none tracking-[-0.02em] text-highlighted">
              {{ formatUsd(headlineCents) }}
              <span class="font-sans text-[16px] tracking-normal text-muted">
                per member / {{ interval === 'yearly' ? 'year' : 'month' }}
              </span>
            </p>
            <p class="mt-3 text-[15px] text-muted">
              <template v-if="interval === 'yearly'">
                Charged once a year — the same as {{ formatUsd(monthlyEquivalentCents) }} a month.
              </template>
              <template v-else>
                Charged every month.
              </template>
              You only pay for people who have joined, starting with the team owner.
            </p>
            <p class="mt-6 max-w-[40ch] text-[16px] leading-relaxed text-muted">
              One shared link the whole team hosts. Round-robin, collective
              meetings, roles and an audit trail — on top of everything above,
              which each member still keeps for themselves.
            </p>
            <p class="my-4 rounded-xl bg-muted px-4 py-3 text-[14px] leading-relaxed text-muted">
              {{ TEAM_PLAN.trialDays }} days free, no card needed. Pending invitations are never billed.
            </p>
            <UButton
              :to="teamDestination"
              prefetch
              size="xl"
              block
              class="mobile-compact-action mt-auto rounded-full text-center font-medium"
            >
              {{ teamCta }}
            </UButton>
          </article>
        </div>
      </div>
    </section>

    <section class="border-b border-default">
      <div class="mx-auto max-w-312 px-6 py-16 lg:px-10 lg:py-20">
        <h2 class="font-editorial text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.02em] text-highlighted">
          What is in each plan
        </h2>

        <p class="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-muted">
          Scan every category at once, then open only the details you want to compare.
        </p>

        <div class="mt-8 overflow-hidden rounded-2xl border border-default bg-default">
          <details
            v-for="(section, sectionIndex) in comparison"
            :key="section.group"
            :open="sectionIndex === 0"
            class="group border-b border-default last:border-b-0"
          >
            <summary class="surface-secondary flex cursor-pointer list-none items-center gap-4 px-5 py-4 marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden">
              <div class="min-w-0 flex-1">
                <h3 class="text-[16px] font-semibold text-highlighted">
                  {{ section.group }}
                </h3>
                <p class="mt-0.5 text-[13px] text-muted">
                  {{ section.rows.length }} features
                </p>
              </div>
              <UIcon
                name="i-lucide-chevron-down"
                class="size-4 shrink-0 text-dimmed transition-transform group-open:rotate-180"
              />
            </summary>

            <div class="overflow-x-auto px-5 pb-3 sm:px-6">
              <table class="w-full min-w-136 border-collapse text-left">
                <thead>
                  <tr class="border-b border-default">
                    <th class="py-3 pr-4 text-[14px] font-medium text-muted">
                      Feature
                    </th>
                    <th class="w-32 py-3 text-[14px] font-medium text-muted">
                      Personal
                    </th>
                    <th class="w-40 py-3 text-[14px] font-medium text-muted">
                      Team
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in section.rows"
                    :key="row.label"
                    class="border-b border-default"
                  >
                    <td class="py-4 pr-4 align-top">
                      <p class="text-[16px] text-highlighted">
                        {{ row.label }}
                      </p>
                      <p
                        v-if="row.detail"
                        class="mt-0.5 text-[14px] leading-relaxed text-muted"
                      >
                        {{ row.detail }}
                      </p>
                    </td>
                    <td
                      v-for="plan in (['free', 'team'] as const)"
                      :key="plan"
                      class="py-4 align-top"
                    >
                      <template v-if="row[plan] === 'soon'">
                        <UBadge
                          color="neutral"
                          variant="subtle"
                          size="sm"
                        >
                          Soon
                        </UBadge>
                      </template>
                      <template v-else-if="typeof row[plan] === 'string'">
                        <span class="text-[15px] text-toned">{{ row[plan] }}</span>
                      </template>
                      <template v-else-if="row[plan]">
                        <UIcon
                          name="i-lucide-check"
                          class="size-4.5 text-primary"
                          :aria-label="`Included in ${plan === 'free' ? 'Personal' : 'Team'}`"
                        />
                      </template>
                      <template v-else>
                        <UIcon
                          name="i-lucide-minus"
                          class="size-4.5 text-dimmed"
                          :aria-label="`Not in ${plan === 'free' ? 'Personal' : 'Team'}`"
                        />
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    </section>

    <section class="bg-muted">
      <div class="mx-auto max-w-312 px-6 py-16 lg:px-10 lg:py-20">
        <div class="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div class="lg:sticky lg:top-32 lg:self-start">
            <h2 class="font-editorial text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.02em] text-highlighted">
              Questions worth asking
            </h2>
          </div>

          <dl class="divide-y divide-default border-y border-default">
            <div
              v-for="faq in faqs"
              :key="faq.q"
              class="py-7"
            >
              <dt class="text-[17px] font-semibold tracking-tight text-highlighted">
                {{ faq.q }}
              </dt>
              <dd class="mt-2 max-w-[60ch] text-[16px] leading-relaxed text-muted">
                {{ faq.a }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  </div>
</template>
