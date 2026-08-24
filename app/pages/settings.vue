<script setup lang="ts">
import { accountApi, apiErrorMessage, profileApi } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Settings', robots: 'noindex, nofollow' })

const { data } = await useCurrentUser()
const { host } = useSiteUrl()
const feedback = useFeedback()
const { signOut } = useAuthClient()
const user = computed(() => data.value?.user)

const profile = reactive({ name: '', bio: '' })
const saving = ref(false)
const error = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)
const removingAvatar = ref(false)
const deleteOpen = ref(false)
const deletingAccount = ref(false)
const deleteForm = reactive({ email: '', confirmation: '' })
const deleteError = ref('')

watchEffect(() => {
  profile.name = user.value?.name ?? ''
  profile.bio = user.value?.bio ?? ''
})

async function save() {
  saving.value = true
  error.value = ''

  try {
    const result = await profileApi.update({ name: profile.name, bio: profile.bio || undefined })
    if (data.value?.user) data.value = { ...data.value, user: result.user }
    await refreshNuxtData('current-user')
    feedback.success({ title: 'Profile saved', description: 'Your public booking page is up to date.' })
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not save that just now.')
  } finally {
    saving.value = false
  }
}

async function chooseAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadingAvatar.value = true
  error.value = ''
  try {
    const result = await profileApi.uploadAvatar(file)
    if (data.value?.user) data.value = { ...data.value, user: { ...data.value.user, avatarUrl: result.avatarUrl } }
    feedback.success({ title: 'Photo updated', description: 'Your new photo is visible on your booking page.' })
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not upload that photo.')
  } finally {
    uploadingAvatar.value = false
  }
}

async function removeAvatar() {
  removingAvatar.value = true
  error.value = ''
  try {
    await profileApi.removeAvatar()
    if (data.value?.user) data.value = { ...data.value, user: { ...data.value.user, avatarUrl: null } }
    feedback.success({ title: 'Photo removed' })
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not remove your photo.')
  } finally {
    removingAvatar.value = false
  }
}

async function deleteAccount() {
  deletingAccount.value = true
  deleteError.value = ''
  try {
    await accountApi.remove({ email: deleteForm.email, confirmation: 'DELETE' })
    await signOut().catch(() => undefined)
    clearNuxtData()
    await navigateTo('/')
  } catch (failure) {
    deleteError.value = apiErrorMessage(failure, 'Could not delete your account. Please try again.')
  } finally {
    deletingAccount.value = false
  }
}

const initials = computed(() => (profile.name || '')
  .split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase())
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Settings"
      description="Your details, and how your booking page reads."
    />

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="border-b border-default px-6 py-5 sm:px-7">
        <h2 class="text-[15px] font-semibold text-highlighted">
          Profile
        </h2>
        <p class="mt-1 text-[13px] text-muted">
          Shown to anyone who opens your booking page.
        </p>
      </div>

      <form
        class="space-y-5 px-6 py-6 sm:px-7"
        @submit.prevent="save"
      >
        <div class="flex flex-wrap items-center gap-4">
          <span class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-[16px] font-semibold text-white">
            <img
              v-if="user?.avatarUrl"
              :src="user.avatarUrl"
              alt=""
              class="size-full object-cover"
            >
            <template v-else>{{ initials }}</template>
          </span>
          <div class="flex flex-wrap gap-2">
            <input
              ref="avatarInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="hidden"
              @change="chooseAvatar"
            >
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              :loading="uploadingAvatar"
              @click="avatarInput?.click()"
            >
              {{ user?.avatarUrl ? 'Replace photo' : 'Upload photo' }}
            </UButton>
            <UButton
              v-if="user?.avatarUrl"
              color="neutral"
              variant="ghost"
              :loading="removingAvatar"
              @click="removeAvatar"
            >
              Remove
            </UButton>
            <p class="w-full text-[12px] text-muted">
              JPG, PNG or WebP. Up to 2 MB.
            </p>
          </div>
        </div>

        <UFormField
          label="Name"
          name="name"
        >
          <UInput
            v-model="profile.name"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Bio"
          name="bio"
          hint="Optional"
        >
          <UTextarea
            v-model="profile.bio"
            :rows="3"
            :maxlength="280"
            placeholder="A sentence about what people can book you for."
            size="lg"
            class="w-full"
          />
          <template #help>
            <span class="tnum">{{ profile.bio.length }}/280</span>
          </template>
        </UFormField>

        <p
          v-if="error"
          class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>

        <div>
          <UButton
            type="submit"
            size="lg"
            :loading="saving"
            class="font-medium"
          >
            Save changes
          </UButton>
        </div>
      </form>
    </section>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="border-b border-default px-6 py-5 sm:px-7">
        <h2 class="text-[15px] font-semibold text-highlighted">
          Account
        </h2>
      </div>

      <dl class="divide-y divide-default text-[14px]">
        <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-7">
          <dt class="text-muted">
            Email
          </dt>
          <dd class="truncate text-highlighted">
            {{ user?.email }}
          </dd>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-7">
          <dt class="text-muted">
            Booking link
          </dt>
          <dd class="truncate text-highlighted">
            {{ host }}/{{ user?.username }}
          </dd>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-7">
          <dt class="text-muted">
            Timezone
          </dt>
          <dd class="text-highlighted">
            {{ user?.timeZone }}
            <NuxtLink
              to="/availability"
              class="ml-2 text-[13px] text-primary underline-offset-4 hover:underline"
            >Change</NuxtLink>
          </dd>
        </div>
      </dl>
    </section>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="border-b border-default px-6 py-5 sm:px-7">
        <h2 class="text-[15px] font-semibold text-highlighted">
          Your data
        </h2>
        <p class="mt-1 text-[13px] text-muted">
          Download a portable copy of your profile, schedules, event types and bookings.
        </p>
      </div>
      <div class="px-6 py-5 sm:px-7">
        <UButton
          :to="accountApi.exportUrl"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
        >
          Download my data
        </UButton>
      </div>
    </section>

    <section class="overflow-hidden rounded-xl border border-error/30 bg-default">
      <div class="px-6 py-5 sm:px-7 sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div>
          <h2 class="text-[15px] font-semibold text-highlighted">
            Delete account
          </h2>
          <p class="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
            Permanently removes your booking links, schedules, bookings and connected calendar credentials.
          </p>
        </div>
        <UButton
          color="error"
          variant="outline"
          class="mt-4 shrink-0 sm:mt-0"
          @click="deleteOpen = true"
        >
          Delete account
        </UButton>
      </div>
    </section>

    <UModal
      v-model:open="deleteOpen"
      title="Permanently delete your account?"
      description="This cannot be undone."
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-[13px] leading-relaxed text-muted">
            Download your data first if you want to keep a copy. To confirm, enter your email and type DELETE.
          </p>
          <UFormField label="Account email">
            <UInput
              v-model="deleteForm.email"
              type="email"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Type DELETE">
            <UInput
              v-model="deleteForm.confirmation"
              autocomplete="off"
              class="w-full"
            />
          </UFormField>
          <p
            v-if="deleteError"
            role="alert"
            class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-3 text-[13px] text-error"
          >
            {{ deleteError }}
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="deletingAccount"
            @click="deleteOpen = false"
          >
            Keep account
          </UButton>
          <UButton
            color="error"
            :disabled="deleteForm.email.toLowerCase() !== user?.email?.toLowerCase() || deleteForm.confirmation !== 'DELETE'"
            :loading="deletingAccount"
            @click="deleteAccount"
          >
            Delete permanently
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
