<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { signInSchema, type SignInInput } from '#shared/validation'

definePageMeta({ layout: 'auth', middleware: 'guest' })
useSeoMeta({ title: 'Sign in to Schedra', robots: 'noindex, nofollow' })

const route = useRoute()
const { signIn } = useAuthClient()
const { data: methods } = useCurrentUser()

// Prefilled when arriving from a team invitation, so the address the
// invitation was sent to is the one they sign in with.
const state = reactive({ email: String(route.query.email ?? ''), password: '' })
const remember = ref(true)
const pending = ref(false)
const error = ref('')
const unverified = ref(false)
const resetComplete = computed(() => route.query.reset === '1')

function safeNext(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/dashboard'
}

async function onSubmit(event: FormSubmitEvent<SignInInput>) {
  pending.value = true
  error.value = ''
  unverified.value = false

  try {
    const { error: failure } = await signIn.email({
      ...event.data,
      rememberMe: remember.value
    })

    if (failure) {
      if (failure.status === 429) {
        error.value = 'Too many sign-in attempts. Wait a few seconds, then try again.'
        return
      }

      if (failure.code === 'EMAIL_NOT_VERIFIED') {
        unverified.value = true
        return
      }

      // Deliberately vague: naming which half was wrong tells an attacker.
      error.value = 'That email and password do not match.'
      return
    }

    clearNuxtData('current-user')
    await navigateTo(safeNext(route.query.next))
  } catch {
    error.value = 'Could not sign in just now. Check your connection and try again.'
  } finally {
    pending.value = false
  }
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

    <p
      v-if="resetComplete"
      class="mt-6 rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-success"
      role="status"
    >
      Your password has been updated. Sign in with the new one.
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
        <PasswordField
          v-model="state.password"
          autocomplete="current-password"
          placeholder="Your password"
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
