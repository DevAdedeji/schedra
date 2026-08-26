<script setup lang="ts">
import {
  EMBED_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  normalizeEmbedAccent,
  normalizeEmbedTheme,
  normalizeParentOrigin,
  type EmbedBookingResult,
  type EmbedMessage
} from '#shared/embed'

const props = defineProps<{
  mode: 'personal' | 'team'
  owner: string
  slug: string
}>()

const route = useRoute()
const colorMode = useColorMode()
const root = useTemplateRef<HTMLElement>('root')

const theme = computed(() => normalizeEmbedTheme(route.query.theme))
const accent = computed(() => normalizeEmbedAccent(route.query.accent))
const parentOrigin = computed(() => normalizeParentOrigin(route.query.parentOrigin))
const prefillName = computed(() => typeof route.query.name === 'string' ? route.query.name.slice(0, 120) : '')
const prefillEmail = computed(() => typeof route.query.email === 'string' ? route.query.email.slice(0, 320) : '')

const accentStyle = computed(() => accent.value
  ? {
      '--ui-primary': accent.value,
      '--ui-color-primary-400': accent.value,
      '--ui-color-primary-500': accent.value,
      '--ui-color-primary-600': accent.value
    }
  : undefined)

function send(type: EmbedMessage['type'], payload?: EmbedMessage['payload']) {
  if (!import.meta.client || window.parent === window) return
  window.parent.postMessage({
    source: EMBED_MESSAGE_SOURCE,
    version: EMBED_MESSAGE_VERSION,
    type,
    payload
  } satisfies EmbedMessage, parentOrigin.value ?? '*')
}

function applyTheme() {
  colorMode.preference = theme.value === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme.value
}

function onBooked(booking: EmbedBookingResult) {
  send('booking.completed', booking)
}

let observer: ResizeObserver | undefined
onMounted(() => {
  applyTheme()
  send('ready')

  observer = new ResizeObserver(() => {
    send('resize', { height: Math.ceil(root.value?.scrollHeight ?? document.documentElement.scrollHeight) })
  })
  if (root.value) observer.observe(root.value)
})

onBeforeUnmount(() => observer?.disconnect())

useSeoMeta({ robots: 'noindex, nofollow' })
useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })
</script>

<template>
  <div
    ref="root"
    :style="accentStyle"
  >
    <BookingFlow
      :mode="props.mode"
      :owner="props.owner"
      :slug="props.slug"
      embedded
      :prefill-name="prefillName"
      :prefill-email="prefillEmail"
      @booked="onBooked"
    />
  </div>
</template>
