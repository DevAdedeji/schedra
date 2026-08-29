<script setup lang="ts">
import { embedPathForBookingPath, embedThemes, type EmbedTheme } from '#shared/embed'

const props = defineProps<{
  open: boolean
  bookingUrl: string
  title: string
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const model = computed({ get: () => props.open, set: value => emit('update:open', value) })
const feedback = useFeedback()
const { copied, copy } = useCopy()

const installType = ref<'button' | 'existing' | 'floating'>('button')
const theme = ref<EmbedTheme>('auto')
const accent = ref('#FF3D00')
const buttonLabel = ref('Book a meeting')
const prefillName = ref('')
const prefillEmail = ref('')
const previewOpen = ref(false)

const installOptions = [
  { value: 'button', label: 'Add a button' },
  { value: 'existing', label: 'Existing button' },
  { value: 'floating', label: 'Floating button' }
]
const themeOptions = embedThemes.map(value => ({
  value,
  label: value === 'auto' ? 'Match visitor device' : value[0]!.toUpperCase() + value.slice(1)
}))

function htmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const scriptUrl = computed(() => {
  try {
    return new URL('/embed.js', props.bookingUrl).toString()
  } catch {
    return '/embed.js'
  }
})

const attributes = computed(() => [
  `data-schedra-embed="${htmlAttribute(props.bookingUrl)}"`,
  `data-schedra-theme="${theme.value}"`,
  `data-schedra-accent="${accent.value}"`,
  prefillName.value.trim() ? `data-schedra-name="${htmlAttribute(prefillName.value.trim())}"` : '',
  prefillEmail.value.trim() ? `data-schedra-email="${htmlAttribute(prefillEmail.value.trim())}"` : ''
].filter(Boolean).join('\n  '))

const snippet = computed(() => {
  const scriptClose = '</scr' + 'ipt>'
  const loader = `<script async src="${htmlAttribute(scriptUrl.value)}">${scriptClose}`
  if (installType.value === 'floating') {
    return `<script async
  src="${htmlAttribute(scriptUrl.value)}"
  data-schedra-floating="${htmlAttribute(props.bookingUrl)}"
  data-schedra-label="${htmlAttribute(buttonLabel.value)}"
  data-schedra-theme="${theme.value}"
  data-schedra-accent="${accent.value}"
>${scriptClose}`
  }

  const content = installType.value === 'existing'
    ? 'Your existing button content'
    : htmlAttribute(buttonLabel.value)
  return `<button type="button"
  ${attributes.value}
>
  ${content}
</button>
${loader}`
})

const previewUrl = computed(() => {
  try {
    const booking = new URL(props.bookingUrl)
    const target = new URL(embedPathForBookingPath(booking.pathname), booking.origin)
    target.searchParams.set('parentOrigin', window.location.origin)
    target.searchParams.set('theme', theme.value)
    target.searchParams.set('accent', accent.value)
    if (prefillName.value.trim()) target.searchParams.set('name', prefillName.value.trim())
    if (prefillEmail.value.trim()) target.searchParams.set('email', prefillEmail.value.trim())
    return target.toString()
  } catch {
    return ''
  }
})

async function copySnippet() {
  const copied = await copy(snippet.value)
  if (copied) feedback.success({ title: 'Embed code copied', description: 'Paste it before the closing body tag on your website.' })
  else feedback.error({ title: 'Could not copy', description: 'Select the code and copy it manually.' })
}
</script>

<template>
  <UModal
    v-model:open="model"
    title="Embed on your website"
    description="Visitors can book without leaving your page. Changes to this event type update every embed automatically."
    :ui="{ content: 'w-full max-w-5xl', body: 'p-0 sm:p-0', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
  >
    <template #body>
      <div class="grid min-h-0 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div class="space-y-5 border-b border-default px-5 py-5 sm:px-6 lg:border-b-0 lg:border-r">
          <UFormField label="How should it appear?">
            <USelectMenu
              v-model="installType"
              :items="installOptions"
              value-key="value"
              aria-label="Embed type"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="installType !== 'existing'"
            label="Button text"
          >
            <UInput
              v-model="buttonLabel"
              maxlength="60"
              class="w-full"
            />
          </UFormField>

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <UFormField label="Theme">
              <USelectMenu
                v-model="theme"
                :items="themeOptions"
                value-key="value"
                aria-label="Embed theme"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Accent colour">
              <div class="flex items-center gap-2">
                <input
                  v-model="accent"
                  type="color"
                  aria-label="Accent colour"
                  class="size-9 shrink-0 cursor-pointer rounded-lg border border-default bg-default p-1"
                >
                <UInput
                  v-model="accent"
                  pattern="#[0-9A-Fa-f]{6}"
                  maxlength="7"
                  class="min-w-0 flex-1 font-mono"
                />
              </div>
            </UFormField>
          </div>

          <details class="rounded-xl border border-default bg-muted/40 px-4 py-3">
            <summary class="cursor-pointer text-[13px] font-medium text-highlighted">
              Prefill visitor details
            </summary>
            <div class="mt-4 grid gap-4">
              <UFormField
                label="Name"
                hint="Optional"
              >
                <UInput
                  v-model="prefillName"
                  autocomplete="off"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Email"
                hint="Optional"
              >
                <UInput
                  v-model="prefillEmail"
                  type="email"
                  autocomplete="off"
                  class="w-full"
                />
              </UFormField>
              <p class="text-[11px] leading-relaxed text-muted">
                Use prefilling only on pages where you already know the visitor. The values are sent directly to Schedra when the overlay opens.
              </p>
            </div>
          </details>
        </div>

        <div class="surface-secondary min-w-0 space-y-4 px-5 py-5 sm:px-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-[13px] font-medium text-highlighted">
                Installation code
              </p>
              <p class="mt-0.5 text-[11px] text-muted">
                Works with plain HTML, website builders and framework apps.
              </p>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-eye"
              @click="previewOpen = true"
            >
              Preview
            </UButton>
          </div>

          <pre class="max-h-96 overflow-auto rounded-xl border border-default bg-inverted p-4 text-[12px] leading-relaxed text-inverted"><code>{{ snippet }}</code></pre>

          <div class="flex items-start gap-2 rounded-xl border border-default bg-default px-3.5 py-3 text-[12px] leading-relaxed text-muted">
            <UIcon
              name="i-lucide-shield-check"
              class="mt-0.5 size-4 shrink-0 text-primary"
            />
            The booking flow is isolated from the website’s styles, uses no third-party cookies and keeps account pages protected from embedding.
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <ModalFooter>
        <template #cancel>
          <UButton
            color="neutral"
            variant="soft"
            @click="model = false"
          >
            Done
          </UButton>
        </template>
        <template #actions>
          <UButton
            :color="copied ? 'success' : 'primary'"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            @click="copySnippet"
          >
            {{ copied ? 'Copied' : 'Copy embed code' }}
          </UButton>
        </template>
      </ModalFooter>
    </template>
  </UModal>

  <UModal
    v-model:open="previewOpen"
    :title="`Preview: ${title}`"
    description="This is the same responsive booking experience visitors will see."
    :ui="{ content: 'w-full max-w-6xl', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <iframe
        v-if="previewUrl"
        :src="previewUrl"
        title="Embedded booking preview"
        class="h-[75dvh] min-h-120 w-full border-0 bg-muted"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
      />
    </template>
  </UModal>
</template>
