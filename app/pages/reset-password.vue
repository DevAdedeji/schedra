<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Choose a new password' })

const route = useRoute()
const { resetPassword } = useAuthClient()

const token = computed(() => String(route.query.token ?? ''))
const invalid = computed(() => !token.value || route.query.error === 'invalid_token')

const password = ref('')
const confirm = ref('')
const pending = ref(false)
const error = ref('')

const strength = usePasswordStrength(password)
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value)

async function submit() {
  if (pending.value) return

  if (password.value !== confirm.value) {
    error.value = 'Those two passwords do not match.'
    return
  }

  pending.value = true
  error.value = ''

  const { error: failure } = await resetPassword({
    newPassword: password.value,
    token: token.value
  })

  pending.value = false

  if (failure) {
    error.value = 'That link has expired or was already used. Request a new one.'
    return
  }

  await navigateTo('/login?reset=1')
}
</script>

<template>
  <div v-if="invalid">
    <h1 class="font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      Link expired.
    </h1>
    <p class="mt-4 text-[15px] leading-relaxed text-muted">
      Reset links work once and last an hour. Ask for a fresh one and it will
      arrive in a moment.
    </p>

    <UButton
      to="/forgot-password"
      size="xl"
      block
      class="mt-8 rounded-full font-medium"
    >
      Send a new link
    </UButton>
  </div>

  <div v-else>
    <h1 class="font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      New password.
    </h1>
    <p class="mt-3 text-[15px] leading-relaxed text-muted">
      Pick something long. You'll be signed out everywhere else.
    </p>

    <form
      class="mt-8 space-y-5"
      novalidate
      @submit.prevent="submit"
    >
      <UFormField
        label="New password"
        name="password"
      >
        <UInput
          v-model="password"
          type="password"
          size="xl"
          autocomplete="new-password"
          placeholder="At least 10 characters"
          required
          class="w-full"
        />

        <div class="mt-2 flex items-center gap-3">
          <div
            class="flex flex-1 gap-1.5"
            aria-hidden="true"
          >
            <span
              v-for="step in 3"
              :key="step"
              class="h-1 flex-1 rounded-full transition-colors"
              :class="strength.score >= step ? strength.barClass : 'bg-accented'"
            />
          </div>
          <span
            v-if="strength.label"
            class="text-[12px] font-medium"
            :class="strength.textClass"
          >{{ strength.label }}</span>
        </div>
      </UFormField>

      <UFormField
        label="Confirm it"
        name="confirm"
      >
        <UInput
          v-model="confirm"
          type="password"
          size="xl"
          autocomplete="new-password"
          required
          class="w-full"
        />
        <p
          v-if="mismatch"
          class="mt-1.5 text-[12px] text-red-600 dark:text-red-500"
        >
          These do not match yet.
        </p>
      </UFormField>

      <p
        v-if="error"
        class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[13px] text-error"
        role="alert"
      >
        {{ error }}
      </p>

      <UButton
        type="submit"
        size="xl"
        block
        :loading="pending"
        :disabled="mismatch || password.length < 10"
        class="rounded-full font-medium"
      >
        Save and sign in
      </UButton>
    </form>
  </div>
</template>
