<script setup lang="ts">
import { apiErrorMessage } from '~/services/schedra-api'

const authClient = useAuthClient()
const { data } = await useCurrentUser()
const feedback = useFeedback()
const { copied, copy } = useCopy()

const enabled = computed(() => Boolean(data.value?.user?.twoFactorEnabled))
const setupOpen = ref(false)
const disableOpen = ref(false)
const setupStep = ref<'password' | 'verify' | 'backup'>('password')
const password = ref('')
const code = ref('')
const totpUri = ref('')
const backupCodes = ref<string[]>([])
const pending = ref(false)
const error = ref('')

const setupKey = computed(() => {
  if (!totpUri.value) return ''
  try {
    return new URL(totpUri.value).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
})

function resetSetup() {
  setupStep.value = 'password'
  password.value = ''
  code.value = ''
  totpUri.value = ''
  backupCodes.value = []
  error.value = ''
}

function openSetup() {
  resetSetup()
  setupOpen.value = true
}

async function beginSetup() {
  pending.value = true
  error.value = ''
  try {
    const result = await authClient.twoFactor.enable({ password: password.value || undefined, issuer: 'Schedra' })
    if (result.error || !result.data) {
      error.value = result.error?.code === 'INVALID_PASSWORD'
        ? 'That password is not correct.'
        : 'Could not start two-factor setup. Check your password and try again.'
      return
    }
    totpUri.value = result.data.totpURI
    backupCodes.value = result.data.backupCodes
    setupStep.value = 'verify'
    password.value = ''
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not start two-factor setup just now.')
  } finally {
    pending.value = false
  }
}

async function verifySetup() {
  const normalized = code.value.trim().replaceAll(' ', '')
  if (!/^\d{6}$/.test(normalized)) {
    error.value = 'Enter the 6-digit code from your authenticator app.'
    return
  }

  pending.value = true
  error.value = ''
  try {
    const result = await authClient.twoFactor.verifyTotp({ code: normalized })
    if (result.error) {
      error.value = 'That code is not valid. Wait for a fresh code and try again.'
      return
    }
    await refreshNuxtData('current-user')
    setupStep.value = 'backup'
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not verify that code just now.')
  } finally {
    pending.value = false
  }
}

async function finishSetup() {
  setupOpen.value = false
  resetSetup()
  feedback.success({ title: 'Two-factor authentication enabled', description: 'Future password sign-ins require an authenticator or backup code.' })
}

async function disable() {
  pending.value = true
  error.value = ''
  try {
    const result = await authClient.twoFactor.disable({ password: password.value || undefined })
    if (result.error) {
      error.value = result.error.code === 'INVALID_PASSWORD'
        ? 'That password is not correct.'
        : 'Could not disable two-factor authentication.'
      return
    }
    await refreshNuxtData('current-user')
    disableOpen.value = false
    password.value = ''
    feedback.success({ title: 'Two-factor authentication disabled' })
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not disable two-factor authentication just now.')
  } finally {
    pending.value = false
  }
}

async function copyValue(value: string, label: string) {
  if (await copy(value)) feedback.success({ title: `${label} copied` })
}
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-default bg-default">
    <div class="border-b border-default px-6 py-5 sm:px-7">
      <h2 class="text-[16px] font-semibold text-highlighted">
        Sign-in security
      </h2>
      <p class="mt-1 text-[14px] text-muted">
        Protect password sign-ins with a code from your authenticator app.
      </p>
    </div>
    <div class="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
      <div class="flex items-center gap-3">
        <span
          class="flex size-9 items-center justify-center rounded-lg"
          :class="enabled ? 'bg-success/10 text-success' : 'bg-elevated text-muted'"
        >
          <UIcon
            :name="enabled ? 'i-lucide-shield-check' : 'i-lucide-shield'"
            class="size-4"
          />
        </span>
        <div>
          <p class="text-[14px] font-medium text-highlighted">
            Two-factor authentication
          </p>
          <p class="text-[13px] text-muted">
            {{ enabled ? 'Enabled for this account.' : 'Not enabled yet.' }}
          </p>
        </div>
      </div>
      <UButton
        v-if="enabled"
        color="error"
        variant="outline"
        @click="password = ''; error = ''; disableOpen = true"
      >
        Disable
      </UButton>
      <UButton
        v-else
        icon="i-lucide-shield-plus"
        @click="openSetup"
      >
        Set up 2FA
      </UButton>
    </div>
  </section>

  <UModal
    v-model:open="setupOpen"
    title="Set up two-factor authentication"
    description="Use any authenticator app that supports time-based codes."
    :dismissible="!pending"
    :ui="{ content: 'w-[92vw] max-w-lg' }"
    @after:leave="resetSetup"
  >
    <template #body>
      <form
        v-if="setupStep === 'password'"
        class="space-y-4"
        @submit.prevent="beginSetup"
      >
        <p class="text-[14px] leading-relaxed text-muted">
          Confirm your password before changing sign-in security. If you created your account only with Google, leave this blank.
        </p>
        <UFormField label="Current password">
          <PasswordField
            v-model="password"
            autocomplete="current-password"
          />
        </UFormField>
        <p
          v-if="error"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="setupOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            :loading="pending"
          >
            Continue
          </UButton>
        </div>
      </form>

      <form
        v-else-if="setupStep === 'verify'"
        class="space-y-4"
        @submit.prevent="verifySetup"
      >
        <ol class="list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-muted">
          <li>Open your authenticator app and add an account manually.</li>
          <li>Use <strong class="text-highlighted">Schedra</strong> as the account name and enter the setup key below.</li>
          <li>Enter the 6-digit code the app generates.</li>
        </ol>
        <div class="rounded-lg border border-default bg-muted p-3">
          <p class="text-[12px] font-medium uppercase tracking-wide text-dimmed">
            Setup key
          </p>
          <div class="mt-1 flex items-center gap-2">
            <code class="min-w-0 flex-1 break-all text-[13px] text-highlighted">{{ setupKey }}</code>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              aria-label="Copy authenticator setup key"
              @click="copyValue(setupKey, 'Setup key')"
            />
          </div>
        </div>
        <UFormField label="Authentication code">
          <UInput
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="000000"
            class="w-full"
          />
        </UFormField>
        <p
          v-if="error"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="setupOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            :loading="pending"
          >
            Verify and enable
          </UButton>
        </div>
      </form>

      <div
        v-else
        class="space-y-4"
      >
        <div class="rounded-lg border border-warning/30 bg-warning/5 p-4 text-[14px] leading-relaxed text-toned">
          Save these single-use backup codes somewhere secure. They are the only way to sign in if you lose your authenticator.
        </div>
        <div class="grid grid-cols-2 gap-2 rounded-lg border border-default bg-muted p-4 font-mono text-[13px] text-highlighted">
          <code
            v-for="backupCode in backupCodes"
            :key="backupCode"
          >{{ backupCode }}</code>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-copy"
            @click="copyValue(backupCodes.join('\n'), 'Backup codes')"
          >
            Copy codes
          </UButton>
          <UButton @click="finishSetup">
            I saved them
          </UButton>
        </div>
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="disableOpen"
    title="Disable two-factor authentication?"
    description="Your account will return to password-only sign in."
    :dismissible="!pending"
    :ui="{ content: 'w-[92vw] max-w-md' }"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="disable"
      >
        <UFormField label="Current password">
          <PasswordField
            v-model="password"
            autocomplete="current-password"
          />
        </UFormField>
        <p
          v-if="error"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="disableOpen = false"
          >
            Keep enabled
          </UButton>
          <UButton
            type="submit"
            color="error"
            :loading="pending"
          >
            Disable 2FA
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
