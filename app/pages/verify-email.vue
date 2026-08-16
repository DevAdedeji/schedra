<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Confirm your email' })

const route = useRoute()
const email = computed(() => String(route.query.email ?? ''))

const sending = ref(false)
const sent = ref(false)
const error = ref('')

async function resend() {
  if (sending.value || !email.value) return
  sending.value = true
  error.value = ''

  try {
    await $fetch('/api/auth/send-verification-email', {
      method: 'POST',
      body: { email: email.value, callbackURL: '/dashboard' }
    })
    sent.value = true
  } catch {
    error.value = 'Could not send just now. Try again in a moment.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div>
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
      We sent a confirmation link to
      <span
        v-if="email"
        class="font-medium text-highlighted"
      >{{ email }}</span>
      <span v-else>your inbox</span>. Click it and your booking link goes live.
    </p>

    <p class="mt-4 text-[14px] leading-relaxed text-dimmed">
      Your account is not usable until the address is confirmed — that way a
      typo can never lock you out of it.
    </p>

    <div class="mt-9 space-y-3">
      <UButton
        v-if="email"
        size="lg"
        color="neutral"
        variant="outline"
        block
        :loading="sending"
        :disabled="sent"
        class="rounded-full font-medium"
        @click="resend"
      >
        {{ sent ? 'Sent again — check your inbox' : 'Resend the email' }}
      </UButton>

      <p
        v-if="error"
        class="text-[13px] text-error"
        role="alert"
      >
        {{ error }}
      </p>
    </div>

    <p class="mt-8 border-t border-default pt-6 text-[14px] text-muted">
      Wrong address?
      <NuxtLink
        to="/signup"
        class="font-medium text-highlighted underline underline-offset-4"
      >Start again</NuxtLink>
    </p>
  </div>
</template>
