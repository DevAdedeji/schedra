<script setup lang="ts">
import { apiErrorMessage, invitationsApi, type InvitationPreview } from '~/services/schedra-api'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
const authClient = useAuthClient()
const feedback = useFeedback()

const { data: invitation, error: loadFailure } = await useAsyncData(
  () => `invitation:${id.value}`,
  () => useRequestFetch()<InvitationPreview>(invitationsApi.previewEndpoint(id.value))
)

const { data: currentUser } = await useCurrentUser()

useSeoMeta({
  title: () => invitation.value ? `Join ${invitation.value.organization.name}` : 'Invitation',
  robots: 'noindex, nofollow'
})

const working = ref(false)
const actionError = ref('')

const viewer = computed(() => currentUser.value?.user ?? null)
const signedIn = computed(() => Boolean(viewer.value))
const emailMatches = computed(() =>
  viewer.value?.email.toLowerCase() === invitation.value?.email.toLowerCase()
)
const verified = computed(() => Boolean(viewer.value?.emailVerified))

/**
 * One flag per branch keeps the template readable: the plan defines eight
 * distinct recipient states and each needs its own wording.
 */
const stage = computed(() => {
  if (!invitation.value) return 'missing'
  if (invitation.value.state !== 'pending') return invitation.value.state
  if (!signedIn.value) return 'signed_out'
  if (!emailMatches.value) return 'wrong_account'
  if (!verified.value) return 'unverified'
  return 'ready'
})

const signupLink = computed(() => `/signup?invite=${encodeURIComponent(id.value)}`)
const loginLink = computed(() =>
  `/login?next=${encodeURIComponent(`/invite/${id.value}`)}&email=${encodeURIComponent(invitation.value?.email ?? '')}`
)

async function accept() {
  if (working.value) return
  working.value = true
  actionError.value = ''

  try {
    const result = await authClient.organization.acceptInvitation({ invitationId: id.value })
    if (result.error) throw new Error(result.error.message ?? 'Could not accept that invitation.')

    feedback.success({
      title: `Welcome to ${invitation.value?.organization.name}`,
      description: 'Your personal booking page is untouched — this only adds team scheduling.'
    })
    await navigateTo(`/w/${invitation.value?.organization.slug}`)
  } catch (failure) {
    actionError.value = apiErrorMessage(failure, 'Could not accept that invitation.')
  } finally {
    working.value = false
  }
}

async function decline() {
  if (working.value) return
  working.value = true
  actionError.value = ''

  try {
    const result = await authClient.organization.rejectInvitation({ invitationId: id.value })
    if (result.error) throw new Error(result.error.message ?? 'Could not decline that invitation.')
    feedback.success({ title: 'Invitation declined' })
    await navigateTo('/dashboard')
  } catch (failure) {
    actionError.value = apiErrorMessage(failure, 'Could not decline that invitation.')
  } finally {
    working.value = false
  }
}

async function switchAccount() {
  await authClient.signOut()
  clearNuxtData('current-user')
  await navigateTo(loginLink.value)
}

async function resendVerification() {
  if (!viewer.value) return
  working.value = true
  try {
    await authClient.sendVerificationEmail({
      email: viewer.value.email,
      callbackURL: `/invite/${id.value}`
    })
    feedback.success({ title: 'Verification sent', description: `Check ${viewer.value.email}.` })
  } catch (failure) {
    actionError.value = apiErrorMessage(failure, 'Could not send that email.')
  } finally {
    working.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-md">
    <div
      v-if="loadFailure || !invitation"
      class="rounded-2xl border border-default bg-default p-6 text-center sm:p-8"
    >
      <span class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-elevated text-dimmed">
        <UIcon
          name="i-lucide-link-2-off"
          class="size-5"
        />
      </span>
      <h1 class="mt-5 text-[18px] font-semibold text-highlighted">
        This invitation link is not valid
      </h1>
      <p class="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted">
        It may have been revoked, or the link may be incomplete. Ask whoever invited you to send a new one.
      </p>
      <UButton
        to="/"
        color="neutral"
        variant="outline"
        class="mt-6"
      >
        Go to Schedra
      </UButton>
    </div>

    <div
      v-else
      class="rounded-2xl border border-default bg-default p-6 sm:p-8"
    >
      <span class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <UIcon
          name="i-lucide-users"
          class="size-5"
        />
      </span>

      <h1 class="mt-5 text-[20px] font-semibold tracking-tight text-highlighted">
        Join {{ invitation.organization.name }}
      </h1>
      <p class="mt-2 text-[13px] leading-relaxed text-muted">
        <span class="font-medium text-toned">{{ invitation.inviterName }}</span>
        invited <span class="font-medium text-toned">{{ invitation.email }}</span>
        to join as {{ invitation.role === 'admin' ? 'an admin' : 'a member' }}.
      </p>

      <div class="mt-5 rounded-xl border border-default bg-muted/50 px-4 py-3">
        <p class="text-[12px] leading-relaxed text-muted">
          Joining never moves or shares your personal schedules, event types, bookings or calendar.
          The workspace only ever sees whether you are free or busy.
        </p>
      </div>

      <!-- Ready to accept -->
      <div
        v-if="stage === 'ready'"
        class="mt-6 space-y-3"
      >
        <UButton
          block
          size="lg"
          :loading="working"
          @click="accept"
        >
          Accept invitation
        </UButton>
        <UButton
          block
          color="neutral"
          variant="ghost"
          size="lg"
          :disabled="working"
          @click="decline"
        >
          Decline
        </UButton>
      </div>

      <!-- No session yet -->
      <div
        v-else-if="stage === 'signed_out'"
        class="mt-6 space-y-3"
      >
        <UButton
          block
          size="lg"
          :to="signupLink"
        >
          Create account to join
        </UButton>
        <UButton
          block
          color="neutral"
          variant="outline"
          size="lg"
          :to="loginLink"
        >
          I already have an account
        </UButton>
        <p class="text-center text-[12px] text-muted">
          Either way you will come back here to finish joining.
        </p>
      </div>

      <!-- Signed in as somebody else -->
      <div
        v-else-if="stage === 'wrong_account'"
        class="mt-6 space-y-3"
      >
        <div class="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
          <p class="text-[12px] leading-relaxed text-muted">
            You are signed in as <span class="font-medium text-highlighted">{{ viewer?.email }}</span>,
            but this invitation is for <span class="font-medium text-highlighted">{{ invitation.email }}</span>.
          </p>
        </div>
        <UButton
          block
          size="lg"
          :loading="working"
          @click="switchAccount"
        >
          Switch account
        </UButton>
      </div>

      <!-- Account exists but the address is unproven -->
      <div
        v-else-if="stage === 'unverified'"
        class="mt-6 space-y-3"
      >
        <div class="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
          <p class="text-[12px] leading-relaxed text-muted">
            Confirm your email address before joining — it is what proves this invitation is yours.
          </p>
        </div>
        <UButton
          block
          size="lg"
          :loading="working"
          @click="resendVerification"
        >
          Resend confirmation email
        </UButton>
      </div>

      <!-- Terminal states -->
      <div
        v-else
        class="mt-6"
      >
        <div class="rounded-xl border border-default bg-muted/50 px-4 py-3">
          <p class="text-[13px] leading-relaxed text-muted">
            <template v-if="stage === 'accepted'">
              This invitation has already been accepted. You are in.
            </template>
            <template v-else-if="stage === 'expired'">
              This invitation expired. Ask {{ invitation.inviterName }} to send a new one.
            </template>
            <template v-else-if="stage === 'archived'">
              {{ invitation.organization.name }} has been archived, so this invitation can no longer be accepted.
            </template>
            <template v-else-if="stage === 'workspace_full'">
              {{ invitation.organization.name }} cannot take new members right now. Ask
              {{ invitation.inviterName }} to check the workspace subscription, then try again.
            </template>
            <template v-else>
              This invitation is no longer available.
            </template>
          </p>
        </div>
        <UButton
          :to="stage === 'accepted' ? `/w/${invitation.organization.slug}` : '/dashboard'"
          block
          color="neutral"
          variant="outline"
          size="lg"
          class="mt-3"
        >
          {{ stage === 'accepted' ? 'Open workspace' : 'Go to Schedra' }}
        </UButton>
      </div>

      <p
        v-if="actionError"
        class="mt-4 text-[13px] text-error"
        role="alert"
      >
        {{ actionError }}
      </p>
    </div>
  </div>
</template>
