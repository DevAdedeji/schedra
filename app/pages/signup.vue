<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { signUpFormSchema, type SignUpFormInput } from '#shared/validation'
import { invitationsApi, usernameApi, type UsernameAvailability } from '~/services/schedra-api'

definePageMeta({ layout: 'auth', middleware: 'guest' })
useSeoMeta({ title: 'Create your Schedra link', robots: 'noindex, nofollow' })

const { signUp } = useAuthClient()
const { data: methods } = useCurrentUser()
const route = useRoute()

const state = reactive({ name: '', username: '', email: '', password: '' })
const touched = ref(false)
const pending = ref(false)
const error = ref('')
const ready = ref(false)

// Arriving from a team invitation: the address is fixed to the one that
// was invited, because membership is only granted when the two match.
const inviteId = computed(() => String(route.query.invite ?? ''))
const { data: invitation } = await useAsyncData(
  () => `signup-invitation:${inviteId.value}`,
  async () => {
    if (!inviteId.value) return null
    return invitationsApi.preview(inviteId.value).catch(() => null)
  },
  { watch: [inviteId] }
)

watch(invitation, (value) => {
  if (value?.email) state.email = value.email
}, { immediate: true })

onMounted(() => {
  ready.value = true
})

function normalise(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .slice(0, 32)
}

watch(() => state.username, (value) => {
  const cleaned = normalise(value)
  if (cleaned !== value) state.username = cleaned
})

watch(() => state.name, (value) => {
  if (!touched.value) state.username = normalise(value)
})

const checking = ref(false)
const availability = ref<UsernameAvailability | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined
let availabilityRequest = 0
let availabilityController: AbortController | undefined

watch(() => state.username, (value) => {
  const request = ++availabilityRequest
  availability.value = null
  clearTimeout(debounce)
  availabilityController?.abort()
  checking.value = false
  if (value.length < 2) return

  checking.value = true
  debounce = setTimeout(async () => {
    availabilityController = new AbortController()

    try {
      const result = await usernameApi.check(value, availabilityController.signal)

      if (request === availabilityRequest && value === state.username) {
        availability.value = result
      }
    } catch {
      if (request === availabilityRequest) availability.value = null
    } finally {
      if (request === availabilityRequest) checking.value = false
    }
  }, 350)
})

onBeforeUnmount(() => {
  clearTimeout(debounce)
  availabilityController?.abort()
})

const linkState = computed<'ok' | 'bad' | 'busy' | null>(() => {
  if (state.username.length < 2) return null
  if (checking.value) return 'busy'
  if (!availability.value) return null
  return availability.value.available ? 'ok' : 'bad'
})

const linkMessage = computed(() => {
  if (state.username.length < 2) return null
  if (checking.value) return { tone: 'muted', text: 'Checking…' }
  if (!availability.value) return null

  return {
    tone: availability.value.available ? 'ok' : 'bad',
    text: availability.value.message
  }
})

async function onSubmit(event: FormSubmitEvent<SignUpFormInput>) {
  if (checking.value || !availability.value?.available) {
    error.value = checking.value
      ? 'Please wait while we check your booking link.'
      : 'Please choose an available booking link.'
    return
  }

  pending.value = true
  error.value = ''

  const { email } = event.data
  // Verifying returns them to the invitation so joining is one continuous flow.
  const callbackURL = inviteId.value
    ? `/invite/${encodeURIComponent(inviteId.value)}`
    : `/verify-email?verified=1&email=${encodeURIComponent(email)}`

  try {
    const { error: failure } = await signUp.email({
      ...event.data,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      callbackURL
    })

    if (failure) {
      if (failure.status === 429) {
        error.value = 'Too many sign-up attempts. Wait a few seconds, then try again.'
        return
      }

      error.value = 'Could not create your account. Check the details and try again.'
      return
    }

    await navigateTo(`/verify-email?email=${encodeURIComponent(email)}`)
  } catch {
    error.value = 'Could not create your account just now. Check your connection and try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      {{ invitation ? `Join ${invitation.organization.name}.` : 'Create your link.' }}
    </h1>
    <p class="mt-3 text-[15px] leading-relaxed text-muted">
      <template v-if="invitation">
        Create your Schedra account to accept the invitation. You get your own booking page too.
      </template>
      <template v-else>
        Free, and about two minutes. You can change any of this later.
      </template>
    </p>

    <template v-if="methods?.google">
      <div class="mt-8">
        <GoogleButton label="Sign up with Google" />
      </div>

      <div class="my-7 flex items-center gap-4">
        <span class="h-px flex-1 bg-border" />
        <span class="text-[12px] text-dimmed">or with email</span>
        <span class="h-px flex-1 bg-border" />
      </div>
    </template>

    <UForm
      :schema="signUpFormSchema"
      :state="state"
      data-testid="signup-form"
      :data-ready="ready ? 'true' : 'false'"
      :class="methods?.google ? 'space-y-5' : 'mt-8 space-y-5'"
      @submit="onSubmit"
    >
      <UFormField
        label="Your name"
        name="name"
      >
        <UInput
          v-model="state.name"
          size="xl"
          autocomplete="name"
          placeholder="Ada Lovelace"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Your booking link"
        name="username"
      >
        <UsernameField
          v-model="state.username"
          :state="linkState"
          @input="touched = true"
        />
        <template #help>
          <span
            v-if="linkMessage"
            :class="{
              'text-green-600 dark:text-green-500': linkMessage.tone === 'ok',
              'text-red-600 dark:text-red-500': linkMessage.tone === 'bad',
              'text-dimmed': linkMessage.tone === 'muted'
            }"
          >{{ linkMessage.text }}</span>
        </template>
      </UFormField>

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
          :disabled="Boolean(invitation)"
          class="w-full"
        />
        <p
          v-if="invitation"
          class="mt-1.5 text-[12px] text-muted"
        >
          {{ invitation.organization.name }} invited this address, so it cannot be changed here.
        </p>
      </UFormField>

      <UFormField
        label="Password"
        name="password"
      >
        <PasswordField
          v-model="state.password"
          autocomplete="new-password"
          placeholder="At least 10 characters"
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
        :disabled="checking || !availability?.available"
        class="rounded-full font-medium"
      >
        Create my link
      </UButton>

      <p class="text-center text-[12px] leading-relaxed text-dimmed">
        We'll email you a link to confirm your address.
      </p>
    </UForm>

    <p class="mt-8 border-t border-default pt-6 text-[14px] text-muted">
      Already have one?
      <NuxtLink
        to="/login"
        class="font-medium text-highlighted underline underline-offset-4"
      >Sign in</NuxtLink>
    </p>
  </div>
</template>
