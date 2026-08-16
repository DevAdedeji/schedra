<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { signInSchema, type SignInInput } from '#shared/validation'

definePageMeta({ layout: 'auth', middleware: 'guest' })
useHead({ title: 'Sign in to Schedra' })

const route = useRoute()
const { signIn } = useAuthClient()
const { data: methods } = await useFetch('/api/auth-methods', { key: 'auth-methods' })

const state = reactive({ email: '', password: '' })
const remember = ref(true)
const pending = ref(false)
const error = ref('')
const unverified = ref(false)

async function onSubmit(event: FormSubmitEvent<SignInInput>) {
  pending.value = true
  error.value = ''
  unverified.value = false

  const { error: failure } = await signIn.email({
    ...event.data,
    rememberMe: remember.value
  })

  pending.value = false

  if (failure) {
    if (failure.status === 403) {
      unverified.value = true
      return
    }

    // Deliberately vague: naming which half was wrong tells an attacker
    error.value = 'That email and password do not match.'
    return
  }

  const next = typeof route.query.next === 'string' ? route.query.next : '/dashboard'
  await navigateTo(next)
}
</script>

<template>
  <div>
    <h1 class="font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      Welcome back.
    </h1>
    <p class="mt-3 text-[15px] leading-relaxed text-muted">
      Manage your hours, your links and everything booked.
    </p>

    <template v-if="methods?.google">
      <div class="mt-8">
        <GoogleButton />
      </div>

      <div class="my-7 flex items-center gap-4">
        <span class="h-px flex-1 bg-border" />
        <span class="text-[12px] text-dimmed">or with email</span>
        <span class="h-px flex-1 bg-border" />
      </div>
    </template>

    <UForm
      :schema="signInSchema"
      :state="state"
      :class="methods?.google ? 'space-y-5' : 'mt-8 space-y-5'"
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

      <UFormField
        label="Password"
        name="password"
      >
        <UInput
          v-model="state.password"
          type="password"
          size="xl"
          autocomplete="current-password"
          placeholder="Your password"
          class="w-full"
        />
      </UFormField>

      <div class="flex items-center justify-between gap-4">
        <UCheckbox
          v-model="remember"
          label="Keep me signed in"
        />
        <NuxtLink
          to="/forgot-password"
          class="text-[13px] text-muted underline underline-offset-4 transition-colors hover:text-highlighted"
        >
          Forgot password?
        </NuxtLink>
      </div>

      <div
        v-if="unverified"
        class="rounded-lg border border-default bg-muted px-3.5 py-3 text-[13px] leading-relaxed text-toned"
        role="alert"
      >
        This email is not confirmed yet. Check your inbox for the link, or
        <NuxtLink
          :to="`/verify-email?email=${encodeURIComponent(state.email.trim())}`"
          class="font-medium text-highlighted underline underline-offset-4"
        >send it again</NuxtLink>.
      </div>

      <p
        v-else-if="error"
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
        Sign in
      </UButton>
    </UForm>

    <p class="mt-8 border-t border-default pt-6 text-[14px] text-muted">
      No link yet?
      <NuxtLink
        to="/signup"
        class="font-medium text-highlighted underline underline-offset-4"
      >Create one free</NuxtLink>
    </p>
  </div>
</template>
