<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useHead({ title: 'Your Schedra' })

const { data } = await useCurrentUser()
const { signOut } = useAuthClient()

const user = computed(() => data.value?.user)
const link = computed(() => `schedra.com/${user.value?.username ?? ''}`)

const copied = ref(false)
const leaving = ref(false)
const signOutError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(`https://${link.value}`)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    // Clipboard unavailable — the link is still selectable by hand.
  }
}

onBeforeUnmount(() => clearTimeout(timer))

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
    <h1 class="font-editorial text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-highlighted">
      Hello, {{ user?.name?.split(' ')[0] }}.
    </h1>
    <p class="mt-3 text-[15px] leading-relaxed text-muted">
      Your account is live. Here is the link people will book you with.
    </p>

    <button
      type="button"
      class="mt-8 flex w-full items-center gap-3 rounded-xl border border-default bg-default px-4 py-3.5 text-left transition-colors hover:border-accented"
      :aria-label="`Copy ${link}`"
      @click="copy"
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
