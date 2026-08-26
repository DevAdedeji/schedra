<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { resetPasswordSchema, type ResetPasswordInput } from '#shared/validation'

definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Choose a new password', robots: 'noindex, nofollow' })

const route = useRoute()
const { resetPassword } = useAuthClient()

const token = computed(() => String(route.query.token ?? ''))
const invalid = computed(() => !token.value || Boolean(route.query.error))

const state = reactive({ password: '', confirm: '' })
const pending = ref(false)
const error = ref('')

async function onSubmit(event: FormSubmitEvent<ResetPasswordInput>) {
  pending.value = true
  error.value = ''

  try {
    const { error: failure } = await resetPassword({
      newPassword: event.data.password,
      token: token.value
    })

    if (failure) {
      error.value = failure.code === 'INVALID_TOKEN'
        ? 'That link has expired or was already used. Request a new one.'
        : 'Could not update the password. Check it and try again.'
      return
    }

    await navigateTo('/login?reset=1')
  } catch {
    error.value = 'Could not update the password just now. Check your connection and try again.'
  } finally {
    pending.value = false
  }
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

    <UForm
      :schema="resetPasswordSchema"
      :state="state"
      class="mt-8 space-y-5"
      @submit="onSubmit"
    >
      <UFormField
        label="New password"
        name="password"
      >
        <PasswordField
          v-model="state.password"
          autocomplete="new-password"
          placeholder="At least 10 characters"
        />
      </UFormField>

      <UFormField
        label="Confirm it"
        name="confirm"
      >
        <PasswordField
          v-model="state.confirm"
          autocomplete="new-password"
          placeholder="Type it again"
        />
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
        class="rounded-full font-medium"
      >
        Save password
      </UButton>
    </UForm>
  </div>
</template>
