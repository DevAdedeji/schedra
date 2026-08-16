<script setup lang="ts">
const props = withDefaults(defineProps<{ label?: string }>(), {
  label: 'Continue with Google'
})

const { signIn } = useAuthClient()
const pending = ref(false)

async function go() {
  pending.value = true
  await signIn.social({ provider: 'google', callbackURL: '/dashboard' })
  pending.value = false
}
</script>

<template>
  <UButton
    type="button"
    size="xl"
    color="neutral"
    variant="outline"
    block
    :loading="pending"
    class="rounded-full font-medium"
    @click="go"
  >
    <template #leading>
      <svg
        class="size-4.5"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fill="#4285F4"
          d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.26-2.09 3.56-5.17 3.56-8.87z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
        />
      </svg>
    </template>
    {{ props.label }}
  </UButton>
</template>
