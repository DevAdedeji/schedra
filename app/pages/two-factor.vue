<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: 'guest' })
useSeoMeta({ title: 'Verify sign in', robots: 'noindex, nofollow' })

const route = useRoute()
const authClient = useAuthClient()
const mode = ref<'authenticator' | 'backup'>('authenticator')
const code = ref('')
const trustDevice = ref(false)
const pending = ref(false)
const error = ref('')
const hydrated = ref(false)

onMounted(() => {
  hydrated.value = true
})

function safeNext(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/dashboard'
}

async function verify() {
  if (pending.value) return
  const normalized = code.value.trim().replaceAll(' ', '')
  if (mode.value === 'authenticator' && !/^\d{6}$/.test(normalized)) {
    error.value = 'Enter the 6-digit code from your authenticator app.'
    return
  }
  if (mode.value === 'backup' && normalized.length < 6) {
    error.value = 'Enter one of your backup codes.'
    return
  }

  pending.value = true
  error.value = ''
  try {
    const result = mode.value === 'authenticator'
      ? await authClient.twoFactor.verifyTotp({ code: normalized, trustDevice: trustDevice.value })
      : await authClient.twoFactor.verifyBackupCode({ code: normalized, trustDevice: trustDevice.value })

    if (result.error) {
      error.value = result.error.code === 'ACCOUNT_TEMPORARILY_LOCKED'
        ? 'Too many incorrect attempts. Wait 15 minutes before trying again.'
        : result.error.status === 429
          ? 'Too many attempts at once. Wait a few seconds and try again.'
          : 'That code is not valid. Check it and try again.'
      return
    }

    clearNuxtData('current-user')
    await navigateTo(safeNext(route.query.next))
  } catch {
    error.value = 'Could not verify the code just now. Check your connection and try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div
    data-testid="two-factor-challenge"
    :data-ready="hydrated"
  >
    <h1 class="font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      One more step.
    </h1>
    <p class="mt-3 text-[16px] leading-relaxed text-muted">
      {{ mode === 'authenticator'
        ? 'Enter the code from your authenticator app to finish signing in.'
        : 'Use one of the backup codes you saved when you enabled two-factor authentication.' }}
    </p>

    <form
      class="mt-8 space-y-5"
      @submit.prevent="verify"
    >
      <UFormField :label="mode === 'authenticator' ? 'Authentication code' : 'Backup code'">
        <UInput
          v-model="code"
          :type="mode === 'authenticator' ? 'text' : 'password'"
          :inputmode="mode === 'authenticator' ? 'numeric' : 'text'"
          :autocomplete="mode === 'authenticator' ? 'one-time-code' : 'off'"
          :maxlength="mode === 'authenticator' ? 6 : 64"
          :placeholder="mode === 'authenticator' ? '000000' : 'Enter backup code'"
          size="xl"
          autofocus
          class="w-full"
        />
      </UFormField>

      <UCheckbox
        v-model="trustDevice"
        label="Trust this device for 30 days"
      />

      <p
        v-if="error"
        class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[14px] text-error"
        role="alert"
      >
        {{ error }}
      </p>

      <UButton
        type="submit"
        size="xl"
        block
        :loading="pending"
        class="rounded-full font-medium"
      >
        Verify and sign in
      </UButton>
    </form>

    <button
      type="button"
      class="mt-6 text-[14px] font-medium text-muted underline underline-offset-4 hover:text-highlighted"
      @click="mode = mode === 'authenticator' ? 'backup' : 'authenticator'; code = ''; error = ''"
    >
      {{ mode === 'authenticator' ? 'Use a backup code instead' : 'Use an authenticator code instead' }}
    </button>
  </div>
</template>
