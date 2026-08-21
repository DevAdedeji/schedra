<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { requestResetSchema, type RequestResetInput } from '#shared/validation'

definePageMeta({ layout: 'auth', middleware: 'guest' })
useHead({ title: 'Reset your password' })

const { requestPasswordReset } = useAuthClient()

const state = reactive({ email: '' })
const pending = ref(false)
const sent = ref(false)
const error = ref('')

async function onSubmit(event: FormSubmitEvent<RequestResetInput>) {
  pending.value = true
  error.value = ''

  try {
    const { error: failure } = await requestPasswordReset({
      email: event.data.email,
      redirectTo: '/reset-password'
    })

    if (failure) {
      error.value = 'Could not send the link just now. Try again in a moment.'
      return
    }

    // Always report success. Saying "no such account" would let anyone check
    // which addresses are registered here.
    sent.value = true
  } catch {
    error.value = 'Could not send the link just now. Check your connection and try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div v-if="sent">
    <span class="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
      <UIcon
        name="i-lucide-mail"
        class="size-5 text-primary"
      />
    </span>

    <h1 class="mt-7 font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      Check your email.
    </h1>
    <p class="mt-4 text-[15px] leading-relaxed text-muted">
      If <span class="font-medium text-highlighted">{{ state.email }}</span> has
      an account, a reset link is on its way. It works once and expires in an
      hour.
    </p>

    <p class="mt-8 border-t border-default pt-6 text-[14px] text-muted">
      <NuxtLink
        to="/login"
        class="font-medium text-highlighted underline underline-offset-4"
      >Back to sign in</NuxtLink>
    </p>
  </div>

  <div v-else>
    <h1 class="font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      Forgot it?
    </h1>
    <p class="mt-3 text-[15px] leading-relaxed text-muted">
      Happens to everyone. Tell us your email and we'll send a link to set a new
      password.
    </p>

    <UForm
      :schema="requestResetSchema"
      :state="state"
      class="mt-8 space-y-5"
      @submit="onSubmit"
    >
      <UFormField
        label="Email"
        name="email"
      >
        <UInput
          v-model="state.email"
          type="email"
          size="xl"
          autocomplete="email"
          placeholder="ada@example.com"
          class="w-full"
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
        Send the link
      </UButton>
    </UForm>

    <p class="mt-8 border-t border-default pt-6 text-[14px] text-muted">
      Remembered it?
      <NuxtLink
        to="/login"
        class="font-medium text-highlighted underline underline-offset-4"
      >Sign in</NuxtLink>
    </p>
  </div>
</template>
