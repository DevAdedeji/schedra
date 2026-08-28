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

const bankItems = computed(() => banks.value.map(bank => ({ label: bank.name, value: bank.code })))
const selectedBank = computed(() => banks.value.find(bank => bank.code === form.bankCode))
const validDetails = computed(() => /^\d{3,6}$/.test(form.bankCode) && /^\d{10}$/.test(form.accountNumber))

function resetVerification() {
  accountName.value = ''
  error.value = ''
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

async function verify() {
  if (!validDetails.value || verifying.value) return
  verifying.value = true
  error.value = ''
  try {
    const result = await paymentsApi.resolvePayoutAccount({ ...form }, props.teamSlug)
    accountName.value = result.accountName
  } catch (failure) {
    accountName.value = ''
    error.value = apiErrorMessage(failure, 'We could not verify that account. Check the details and try again.')
  } finally {
    verifying.value = false
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

watch(() => form.bankCode, resetVerification)
watch(() => form.accountNumber, resetVerification)
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
        @submit.prevent="accountName ? save() : verify()"
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
          class="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-circle-check"
            class="mt-0.5 size-5 shrink-0 text-success"
          />
          <div class="min-w-0">
            <p class="text-sm font-semibold text-highlighted">
              {{ accountName }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              {{ selectedBank?.name }} · ending in {{ form.accountNumber.slice(-4) }}
            </p>
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
          :loading="accountName ? saving : verifying"
          :disabled="accountName ? saving : !validDetails"
          :icon="accountName ? 'i-lucide-check' : 'i-lucide-search-check'"
        >
          {{ accountName ? 'Add payout account' : 'Verify account' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
