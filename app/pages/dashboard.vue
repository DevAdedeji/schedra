<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Your Schedra', robots: 'noindex, nofollow' })

const { data } = await useCurrentUser()
const { signOut } = useAuthClient()

const user = computed(() => data.value?.user)
const { url, host } = useSiteUrl()
const link = computed(() => `${host.value}/${user.value?.username ?? ''}`)

const { copied, copy } = useCopy()

const profile = reactive({ name: '', bio: '' })
const savingProfile = ref(false)
const savedProfile = ref(false)
const profileError = ref('')

watchEffect(() => {
  profile.name = user.value?.name ?? ''
  profile.bio = user.value?.bio ?? ''
})

async function saveProfile() {
  savingProfile.value = true
  savedProfile.value = false
  profileError.value = ''

  try {
    await $fetch('/api/profile', {
      method: 'PATCH',
      body: { name: profile.name, bio: profile.bio || undefined }
    })
    savedProfile.value = true
    await refreshNuxtData('current-user')
  } catch (failure) {
    profileError.value = (failure as { statusMessage?: string }).statusMessage
      ?? 'Could not save that just now.'
  } finally {
    savingProfile.value = false
  }
}

const leaving = ref(false)
const signOutError = ref('')

async function leave() {
  leaving.value = true
  signOutError.value = ''

  try {
    const { error } = await signOut()
    if (error) {
      signOutError.value = 'Could not sign out just now. Try again.'
      return
    }

    clearNuxtData('current-user')
    await navigateTo('/login')
  } catch {
    signOutError.value = 'Could not sign out just now. Check your connection and try again.'
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="font-editorial text-4xl leading-[1.05] tracking-[-0.02em] text-highlighted sm:text-[2.5rem]">
      Hello, {{ user?.name?.split(' ')[0] }}.
    </h1>
    <p class="mt-3 text-[15px] leading-relaxed text-muted">
      Your account is live. Here is the link people will book you with.
    </p>

    <button
      type="button"
      class="mt-8 flex w-full items-center gap-3 rounded-xl border border-default bg-default px-4 py-3.5 text-left transition-colors hover:border-accented"
      :aria-label="`Copy ${link}`"
      @click="copy(`${url}/${user?.username ?? ''}`)"
    >
      <UIcon
        name="i-lucide-link"
        class="size-4 shrink-0 text-primary"
      />
      <span class="truncate text-[14px] text-highlighted">{{ link }}</span>
      <UIcon
        :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        class="ml-auto size-4 shrink-0"
        :class="copied ? 'text-primary' : 'text-dimmed'"
      />
    </button>

    <section class="mt-10 rounded-2xl border border-default bg-default p-6 sm:p-7">
      <h2 class="text-[15px] font-semibold text-highlighted">
        Your profile
      </h2>
      <p class="mt-1 text-[13px] text-muted">
        This is what people see on your booking page.
      </p>

      <form
        class="mt-6 space-y-4"
        @submit.prevent="saveProfile"
      >
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
          v-if="profileError"
          class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[13px] text-error"
          role="alert"
        >
          {{ profileError }}
        </p>

        <div class="flex items-center gap-3">
          <UButton
            type="submit"
            size="lg"
            :loading="savingProfile"
            class="rounded-full px-6 font-medium"
          >
            Save
          </UButton>
          <span
            v-if="savedProfile"
            class="text-[13px] text-primary"
          >Saved</span>
        </div>
      </form>
    </section>

    <div class="mt-8 rounded-xl border border-dashed border-default px-4 py-6 text-center">
      <p class="text-[14px] text-muted">
        Setting your hours and creating event types comes next.
      </p>
      <p class="mt-1 text-[13px] text-dimmed">
        The link above will not take bookings until then.
      </p>
    </div>

    <dl class="mt-8 divide-y divide-default border-y border-default text-[14px]">
      <div class="flex items-center justify-between py-3">
        <dt class="text-muted">
          Email
        </dt>
        <dd class="text-highlighted">
          {{ user?.email }}
        </dd>
      </div>
      <div class="flex items-center justify-between py-3">
        <dt class="text-muted">
          Timezone
        </dt>
        <dd class="text-highlighted">
          {{ user?.timeZone }}
        </dd>
      </div>
    </dl>

    <UButton
      color="neutral"
      variant="ghost"
      size="lg"
      :loading="leaving"
      class="mt-8 rounded-full font-medium"
      @click="leave"
    >
      Sign out
    </UButton>

    <p
      v-if="signOutError"
      class="mt-3 text-[13px] text-error"
      role="alert"
    >
      {{ signOutError }}
    </p>
  </div>
</template>
