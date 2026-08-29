<script setup lang="ts">
import { formatMoney, type PaymentCurrency } from '#shared/payments'
import {
  apiErrorMessage,
  paymentsApi,
  type PaymentWithdrawalOptions,
  type PaymentWithdrawalPreview,
  type PaymentWithdrawalRecord
} from '~/services/schedra-api'
import { formatDateTime } from '~/utils/date-time'

const props = defineProps<{ teamSlug?: string }>()
const emit = defineEmits<{ updated: [] }>()
const toast = useToast()
const endpoint = computed(() => paymentsApi.withdrawalsEndpoint(props.teamSlug))
const { data, status, error, refresh } = await useLazyFetch<PaymentWithdrawalOptions>(endpoint)

const open = ref(false)
const sourceCurrency = ref<PaymentCurrency>('NGN')
const destinationId = ref('')
const amount = ref('')
const preview = ref<PaymentWithdrawalPreview | null>(null)
const requestId = ref<string | null>(null)
const previewing = ref(false)
const submitting = ref(false)
const formError = ref('')

const availableOptions = computed(() => (data.value?.available ?? [])
  .filter(balance => balance.amountCents > 0)
  .map(balance => ({
    value: balance.currency,
    label: `${formatMoney(balance.amountCents, balance.currency)} available`
  })))

const destinationOptions = computed(() => (data.value?.destinations ?? []).map(destination => ({
  value: destination.id,
  label: `${destination.name} · ${destination.currency}${destination.isDefault ? ' · Default' : ''}`
})))

const selectedDestination = computed(() => data.value?.destinations.find(item => item.id === destinationId.value))
const selectedBalance = computed(() => data.value?.available.find(item => item.currency === sourceCurrency.value))
const crossCurrency = computed(() => Boolean(
  selectedDestination.value && selectedDestination.value.currency !== sourceCurrency.value
))
const canStart = computed(() => Boolean(data.value?.ready && availableOptions.value.length && destinationOptions.value.length))

watch(data, (value) => {
  if (!availableOptions.value.some(option => option.value === sourceCurrency.value)) {
    sourceCurrency.value = availableOptions.value[0]?.value ?? 'NGN'
  }
  if (!value?.destinations.some(destination => destination.id === destinationId.value)) {
    destinationId.value = value?.destinations.find(destination => destination.isDefault)?.id
      ?? value?.destinations[0]?.id
      ?? ''
  }
}, { immediate: true })

watch([sourceCurrency, destinationId, amount], () => {
  if (preview.value) {
    preview.value = null
    requestId.value = null
  }
  formError.value = ''
})

function inputCents(value: string) {
  const normalized = value.trim().replaceAll(',', '')
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null
  const [whole = '0', fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

function openWithdrawal() {
  resetForm()
  open.value = true
}

function resetForm() {
  preview.value = null
  requestId.value = null
  amount.value = ''
  formError.value = ''
  sourceCurrency.value = availableOptions.value[0]?.value ?? 'NGN'
  destinationId.value = data.value?.destinations.find(destination => destination.isDefault)?.id
    ?? data.value?.destinations[0]?.id
    ?? ''
}

async function reviewWithdrawal() {
  const amountCents = inputCents(amount.value)
  if (!amountCents || !destinationId.value) {
    formError.value = 'Choose where the money should go and enter a valid amount.'
    return
  }
  if (selectedBalance.value && amountCents > selectedBalance.value.amountCents) {
    formError.value = 'Enter an amount within the available balance.'
    return
  }

  previewing.value = true
  formError.value = ''
  try {
    preview.value = await paymentsApi.previewWithdrawal({
      destinationId: destinationId.value,
      sourceCurrency: sourceCurrency.value,
      amountCents
    }, props.teamSlug)
    requestId.value = crypto.randomUUID()
  } catch (failure) {
    formError.value = apiErrorMessage(failure, 'The withdrawal could not be previewed. No money was moved.')
  } finally {
    previewing.value = false
  }
}

async function confirmWithdrawal() {
  if (!preview.value || !requestId.value) return
  submitting.value = true
  formError.value = ''
  try {
    const withdrawal = await paymentsApi.createWithdrawal({
      requestId: requestId.value,
      confirmationToken: preview.value.confirmationToken
    }, props.teamSlug)
    const uncertain = withdrawal.status === 'unknown' || withdrawal.status === 'creating'
    toast.add({
      title: uncertain ? 'Withdrawal is being verified' : 'Withdrawal submitted',
      description: uncertain
        ? 'Do not submit it again. Schedra is checking the same request with Bachs.'
        : 'Bachs accepted the request. We will show Paid only after the destination confirms delivery.',
      color: uncertain ? 'warning' : 'success'
    })
    open.value = false
    await refresh()
    emit('updated')
  } catch (failure) {
    formError.value = apiErrorMessage(failure, 'The withdrawal could not be submitted. Review a new preview before trying again.')
    preview.value = null
    requestId.value = null
  } finally {
    submitting.value = false
  }
}

const statusCopy = (value: PaymentWithdrawalRecord['status']) => ({
  creating: 'Submitting',
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Paid',
  failed: 'Failed',
  unknown: 'Verifying'
} as const)[value]

const statusColor = (value: PaymentWithdrawalRecord['status']) => ({
  creating: 'warning',
  pending: 'warning',
  processing: 'warning',
  completed: 'success',
  failed: 'error',
  unknown: 'warning'
} as const)[value]

function withdrawalAmount(withdrawal: PaymentWithdrawalRecord) {
  const cents = withdrawal.deliveredAmountCents ?? withdrawal.requestedAmountCents
  const currency = withdrawal.deliveredAmountCents == null
    ? withdrawal.sourceCurrency
    : withdrawal.destinationCurrency
  return formatMoney(cents, currency)
}
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-default bg-default">
    <header class="flex flex-col gap-4 border-b border-default p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6 surface-secondary">
      <div>
        <div class="flex items-center gap-2">
          <span class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon
              name="i-lucide-landmark"
              class="size-4"
            />
          </span>
          <h2 class="text-base font-semibold text-highlighted">
            Withdraw funds
          </h2>
        </div>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Send settled funds from your Bachs balance to an approved destination. Delivery is confirmed asynchronously.
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="status === 'pending'"
          aria-label="Refresh withdrawal status"
          @click="() => refresh()"
        />
        <UButton
          icon="i-lucide-banknote-arrow-up"
          :disabled="!canStart"
          @click="openWithdrawal"
        >
          Withdraw
        </UButton>
      </div>
    </header>

    <div
      v-if="status === 'pending' && !data"
      class="grid gap-4 p-5 sm:grid-cols-3 sm:p-6"
    >
      <USkeleton
        v-for="item in 3"
        :key="item"
        class="h-16 w-full"
      />
    </div>
    <AsyncErrorState
      v-else-if="error && !data"
      compact
      title="Could not load withdrawal details"
      description="No money was moved. Check Bachs again before withdrawing."
      :retrying="status === 'pending'"
      @retry="refresh"
    />
    <div
      v-else
      class="space-y-5 p-5 sm:p-6"
    >
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-xl border border-default p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Available to withdraw
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <UBadge
              v-for="balance in data?.available"
              :key="balance.currency"
              color="neutral"
              variant="subtle"
              size="lg"
            >
              {{ formatMoney(balance.amountCents, balance.currency) }}
            </UBadge>
            <span
              v-if="!data?.available.some(balance => balance.amountCents > 0)"
              class="text-sm text-muted"
            >No settled balance yet</span>
          </div>
        </div>
        <div class="rounded-xl border border-default p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Approved destinations
          </p>
          <p class="mt-2 text-sm text-toned">
            {{ data?.destinations.length
              ? `${data.destinations.length} destination${data.destinations.length === 1 ? '' : 's'} ready in Bachs`
              : 'No approved payout destination is available.' }}
          </p>
        </div>
      </div>

      <div
        v-if="data && !data.ready"
        class="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-toned"
      >
        <UIcon
          name="i-lucide-shield-alert"
          class="mt-0.5 size-4 shrink-0 text-warning"
        />
        Bachs must finish reviewing the payout account and destination before withdrawals can be submitted.
      </div>

      <div v-if="data?.withdrawals.length">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-highlighted">
            Recent withdrawals
          </h3>
          <p class="text-xs text-muted">
            Paid means Bachs confirmed delivery.
          </p>
        </div>
        <ul class="divide-y divide-default rounded-xl border border-default">
          <li
            v-for="withdrawal in data.withdrawals"
            :key="withdrawal.id"
            class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-medium text-highlighted">
                  {{ withdrawalAmount(withdrawal) }}
                </p>
                <UBadge
                  :color="statusColor(withdrawal.status)"
                  variant="subtle"
                >
                  {{ statusCopy(withdrawal.status) }}
                </UBadge>
              </div>
              <p class="mt-1 text-xs text-muted">
                {{ withdrawal.destinationName }} · {{ formatDateTime(withdrawal.createdAt, 'en') }}
              </p>
              <p
                v-if="withdrawal.failureReason"
                class="mt-1 text-xs text-error"
              >
                {{ withdrawal.failureReason }}
              </p>
            </div>
            <p
              v-if="withdrawal.totalDebitedCents != null"
              class="shrink-0 text-xs text-muted"
            >
              {{ formatMoney(withdrawal.totalDebitedCents, withdrawal.sourceCurrency) }} debited
            </p>
          </li>
        </ul>
      </div>
    </div>

    <UModal
      v-model:open="open"
      :dismissible="!submitting"
      :title="preview ? 'Confirm withdrawal' : 'Withdraw funds'"
      :description="preview ? 'Review the final route carefully. A submitted withdrawal cannot be cancelled.' : 'Choose the balance and approved destination, then review the provider amount before confirming.'"
      :ui="{ content: 'w-full max-w-lg', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <div
          v-if="preview"
          class="space-y-4"
        >
          <dl class="divide-y divide-default rounded-xl border border-default px-4">
            <div class="flex items-center justify-between gap-4 py-3">
              <dt class="text-sm text-muted">
                From your balance
              </dt>
              <dd class="font-medium tabular-nums text-highlighted">
                {{ formatMoney(preview.totalDebitedCents, preview.sourceCurrency) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4 py-3">
              <dt class="text-sm text-muted">
                Destination receives
              </dt>
              <dd class="font-medium tabular-nums text-highlighted">
                {{ formatMoney(preview.deliveredAmountCents, preview.destinationCurrency) }}
              </dd>
            </div>
            <div
              v-if="preview.feeCents != null"
              class="flex items-center justify-between gap-4 py-3"
            >
              <dt class="text-sm text-muted">
                Bachs fee
              </dt>
              <dd class="tabular-nums text-toned">
                {{ formatMoney(preview.feeCents, preview.sourceCurrency) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4 py-3">
              <dt class="text-sm text-muted">
                Send to
              </dt>
              <dd class="text-right font-medium text-highlighted">
                {{ preview.destination.name }}
              </dd>
            </div>
          </dl>
          <div class="flex items-start gap-2 rounded-xl border border-error/25 bg-error/5 px-4 py-3 text-sm leading-relaxed text-toned">
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0 text-error"
            />
            Check the destination and amount carefully. Bachs debits the balance immediately after accepting this request, and it cannot be cancelled.
          </div>
        </div>

        <div
          v-else
          class="space-y-5"
        >
          <UFormField
            label="Balance"
            required
          >
            <USelectMenu
              v-model="sourceCurrency"
              :items="availableOptions"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Payout destination"
            required
            help="Bank and identity details remain in Bachs. Schedra stores only the destination reference and name."
          >
            <USelectMenu
              v-model="destinationId"
              :items="destinationOptions"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="crossCurrency ? `Amount from ${sourceCurrency} balance` : 'Amount destination receives'"
            required
            :help="crossCurrency
              ? `Bachs will quote how much arrives in ${selectedDestination?.currency}. Provider fees are included in the converted delivery amount.`
              : 'The Bachs withdrawal fee is added on top and shown before confirmation.'"
          >
            <UInput
              v-model="amount"
              inputmode="decimal"
              :placeholder="sourceCurrency === 'NGN' ? '5000.00' : '5.00'"
              class="w-full"
            >
              <template #leading>
                <span class="text-xs font-semibold text-muted">{{ sourceCurrency }}</span>
              </template>
            </UInput>
          </UFormField>
        </div>

        <p
          v-if="formError"
          class="mt-4 rounded-lg border border-error/30 bg-error/10 px-3.5 py-3 text-sm text-error"
          role="alert"
        >
          {{ formError }}
        </p>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="submitting"
              @click="open = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              v-if="preview"
              color="error"
              icon="i-lucide-banknote-arrow-up"
              :loading="submitting"
              @click="confirmWithdrawal"
            >
              Confirm withdrawal
            </UButton>
            <UButton
              v-else
              icon="i-lucide-shield-check"
              :loading="previewing"
              :disabled="!destinationId || !amount"
              @click="reviewWithdrawal"
            >
              Review withdrawal
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>
  </section>
</template>
