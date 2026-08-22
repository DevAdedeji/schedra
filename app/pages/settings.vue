<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Settings', robots: 'noindex, nofollow' })

const { data } = await useCurrentUser()
const { host } = useSiteUrl()
const user = computed(() => data.value?.user)

const profile = reactive({ name: '', bio: '' })
const saving = ref(false)
const saved = ref(false)
const error = ref('')

watchEffect(() => {
  profile.name = user.value?.name ?? ''
  profile.bio = user.value?.bio ?? ''
})

async function save() {
  saving.value = true
  saved.value = false
  error.value = ''

  try {
    await $fetch('/api/profile', {
      method: 'PATCH',
      body: { name: profile.name, bio: profile.bio || undefined }
    })
    saved.value = true
    await refreshNuxtData('current-user')
  } catch (failure) {
    error.value = (failure as { statusMessage?: string }).statusMessage
      ?? 'Could not save that just now.'
  } finally {
    saving.value = false
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
        <div class="flex items-center gap-4">
          <span class="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-[16px] font-semibold text-white">
            {{ initials }}
          </span>
          <p class="text-[13px] leading-relaxed text-muted">
            Your initials stand in for a photo.<br>
            Avatar uploads are not built yet.
          </p>
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

        <div class="flex items-center gap-3">
          <UButton
            type="submit"
            size="lg"
            :loading="saving"
            class="font-medium"
          >
            Save changes
          </UButton>
          <span
            v-if="saved"
            class="text-[13px] text-primary"
          >Saved</span>
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
  </div>
</template>
