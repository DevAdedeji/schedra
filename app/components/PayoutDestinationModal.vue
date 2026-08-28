<script setup lang="ts">
import {
  apiErrorMessage,
  paymentsApi,
  type PaymentAccountSummary,
  type PayoutBank
} from '~/services/schedra-api'

const props = defineProps<{ open: boolean, teamSlug?: string }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': [account: PaymentAccountSummary]
}>()

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const banks = ref<PayoutBank[]>([])
const loadingBanks = ref(false)
const verifying = ref(false)
const saving = ref(false)
const error = ref('')
const form = reactive({ bankCode: '', accountNumber: '' })
const accountName = ref('')
let verificationTimer: ReturnType<typeof setTimeout> | undefined
let verificationRevision = 0

const bankItems = computed(() => banks.value.map(bank => ({ label: bank.name, value: bank.code })))
const selectedBank = computed(() => banks.value.find(bank => bank.code === form.bankCode))
const validDetails = computed(() => /^\d{3,6}$/.test(form.bankCode) && /^\d{10}$/.test(form.accountNumber))

function scheduleVerification() {
  if (verificationTimer) clearTimeout(verificationTimer)
  const revision = ++verificationRevision
  accountName.value = ''
  error.value = ''
  verifying.value = false
  if (!validDetails.value) return
  verificationTimer = setTimeout(() => void verify(revision), 450)
}

function updateAccountNumber(value: string | number) {
  form.accountNumber = String(value).replace(/\D/g, '').slice(0, 10)
}

async function loadBanks() {
  if (banks.value.length || loadingBanks.value) return
  loadingBanks.value = true
  try {
    const response = await $fetch<{ items: PayoutBank[] }>(paymentsApi.banksEndpoint)
    banks.value = response.items
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not load the supported banks. Try again.')
  } finally {
    loadingBanks.value = false
  }
}

async function verify(revision: number) {
  if (!validDetails.value || revision !== verificationRevision) return
  const bankCode = form.bankCode
  const accountNumber = form.accountNumber
  verifying.value = true
  error.value = ''
  try {
    const result = await paymentsApi.resolvePayoutAccount({ bankCode, accountNumber }, props.teamSlug)
    if (revision !== verificationRevision || bankCode !== form.bankCode || accountNumber !== form.accountNumber) return
    accountName.value = result.accountName
  } catch (failure) {
    if (revision !== verificationRevision) return
    accountName.value = ''
    error.value = apiErrorMessage(failure, 'We could not verify that account. Check the details and try again.')
  } finally {
    if (revision === verificationRevision) verifying.value = false
  }
}

async function save() {
  if (!accountName.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const account = await paymentsApi.savePayoutAccount({ ...form }, props.teamSlug)
    emit('saved', account)
    isOpen.value = false
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not add that payout account. Try again.')
  } finally {
    saving.value = false
  }
}

function reset() {
  if (verificationTimer) clearTimeout(verificationTimer)
  verificationRevision++
  form.bankCode = ''
  form.accountNumber = ''
  accountName.value = ''
  error.value = ''
  verifying.value = false
}

watch(() => props.open, (open) => {
  if (open) void loadBanks()
  else reset()
}, { immediate: true })

watch([() => form.bankCode, () => form.accountNumber], scheduleVerification)
onBeforeUnmount(() => {
  if (verificationTimer) clearTimeout(verificationTimer)
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :dismissible="false"
    title="Add your payout account"
    description="Choose where Bachs should send money from your paid bookings."
    :ui="{ content: 'w-full max-w-lg', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
  >
    <template #body>
      <form
        id="payout-destination-form"
        class="space-y-5"
        @submit.prevent="save"
      >
        <div class="rounded-xl border border-default bg-muted/40 p-4">
          <div class="flex items-start gap-3">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon
                name="i-lucide-shield-check"
                class="size-4"
              />
            </span>
            <p class="text-[13px] leading-relaxed text-muted">
              Bachs verifies your bank details securely. Schedra uses them for this request and does not store your account number.
            </p>
          </div>
        </div>

        <UFormField
          label="Bank"
          name="bankCode"
          required
        >
          <USelectMenu
            v-model="form.bankCode"
            :items="bankItems"
            value-key="value"
            label-key="label"
            searchable
            :loading="loadingBanks"
            :disabled="loadingBanks || saving"
            placeholder="Search for your bank"
            icon="i-lucide-landmark"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <div
          v-if="verifying"
          class="flex items-center gap-2 text-[13px] text-muted"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
          />
          Verifying account details…
        </div>

        <UFormField
          label="Account number"
          name="accountNumber"
          required
          help="Enter the 10-digit Naira account number."
        >
          <UInput
            :model-value="form.accountNumber"
            inputmode="numeric"
            autocomplete="off"
            maxlength="10"
            placeholder="0123456789"
            icon="i-lucide-credit-card"
            size="lg"
            class="w-full"
            :disabled="saving"
            @update:model-value="updateAccountNumber"
          />
        </UFormField>

        <div
          v-if="accountName"
          class="rounded-xl border border-success/30 bg-success/10 p-4"
          aria-live="polite"
        >
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-circle-check"
              class="size-5 shrink-0 text-success"
            />
            <p class="text-sm font-semibold text-success">
              Account verified
            </p>
          </div>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div class="min-w-0">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Account holder
              </p>
              <p class="mt-1 truncate text-sm font-semibold text-highlighted">
                {{ accountName }}
              </p>
            </div>
            <div class="min-w-0">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Payout account
              </p>
              <p class="mt-1 truncate text-sm font-medium text-highlighted">
                {{ selectedBank?.name }} · •••• {{ form.accountNumber.slice(-4) }}
              </p>
            </div>
          </div>
        </div>

        <p
          v-if="error"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <UButton
          color="neutral"
          variant="soft"
          :disabled="saving"
          @click="isOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          type="submit"
          form="payout-destination-form"
          :loading="saving"
          :disabled="!accountName || saving || verifying"
          icon="i-lucide-check"
        >
          Add payout account
        </UButton>
      </div>
    </template>
  </UModal>
</template>
