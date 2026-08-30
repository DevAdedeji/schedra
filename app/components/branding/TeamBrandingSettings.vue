<script setup lang="ts">
import {
  DEFAULT_PERSONAL_BRANDING,
  readableTextColor,
  type BookingPageTheme,
  type PublicPersonalBranding
} from '#shared/branding'
import { apiErrorMessage, teamBrandingApi } from '~/services/schedra-api'

const props = defineProps<{ teamSlug: string, teamName: string }>()
const feedback = useFeedback()
const logoInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const uploading = ref(false)
const removing = ref(false)
const form = reactive({ ...DEFAULT_PERSONAL_BRANDING })
const endpoint = computed(() => teamBrandingApi.endpoint(props.teamSlug))
const { data, status, error, refresh } = await useLazyFetch<{ branding: PublicPersonalBranding }>(endpoint)

watch(() => data.value?.branding, (value) => {
  if (value) Object.assign(form, value)
}, { immediate: true })
watch(() => props.teamName, (value) => {
  form.brandName = value
})

const themeOptions: Array<{ label: string, value: BookingPageTheme }> = [
  { label: 'Follow the visitor’s device', value: 'system' },
  { label: 'Always light', value: 'light' },
  { label: 'Always dark', value: 'dark' }
]
const previewStyle = computed(() => ({
  '--preview-brand': form.brandColor,
  '--preview-brand-contrast': readableTextColor(form.brandColor)
}))

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const result = await teamBrandingApi.update(props.teamSlug, {
      brandColor: form.brandColor,
      brandDarkColor: form.brandDarkColor,
      bookingPageTheme: form.bookingPageTheme,
      hideSchedraBranding: form.hideSchedraBranding
    })
    Object.assign(form, result.branding)
    feedback.success({ title: 'Team branding saved', description: 'Public team pages now use these settings.' })
  } catch (failure) {
    feedback.error({ title: 'Could not save team branding', description: apiErrorMessage(failure, 'Check the colours and try again.') })
  } finally {
    saving.value = false
  }
}

async function chooseLogo(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const result = await teamBrandingApi.uploadLogo(props.teamSlug, file)
    form.logoUrl = result.logoUrl
    feedback.success({ title: 'Team logo updated' })
  } catch (failure) {
    feedback.error({ title: 'Could not upload logo', description: apiErrorMessage(failure, 'Use a JPG, PNG or WebP file under 2 MB.') })
  } finally {
    uploading.value = false
  }
}

async function removeLogo() {
  if (removing.value) return
  removing.value = true
  try {
    await teamBrandingApi.removeLogo(props.teamSlug)
    form.logoUrl = null
    feedback.success({ title: 'Team logo removed' })
  } catch (failure) {
    feedback.error({ title: 'Could not remove logo', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <AsyncErrorState
    v-if="error && !data"
    title="Could not load team branding"
    description="The public team page is unchanged."
    :retrying="status === 'pending'"
    @retry="refresh"
  />
  <ListLoadingSkeleton
    v-else-if="status === 'pending' && !data"
    label="Loading team branding"
  />
  <section
    v-else
    class="overflow-hidden rounded-xl border border-default bg-default"
  >
    <header class="border-b border-default px-5 py-4">
      <h2 class="text-[15px] font-semibold text-highlighted">
        Organization branding
      </h2>
      <p class="mt-1 text-[13px] text-muted">
        Applied to the public team page, event pages and embedded booking flow.
      </p>
    </header>

    <div class="grid gap-7 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <form
        class="space-y-5"
        @submit.prevent="save"
      >
        <div>
          <p class="text-[14px] font-medium text-highlighted">
            Team logo
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <span class="flex h-14 w-28 items-center justify-center overflow-hidden rounded-lg border border-default bg-muted p-2">
              <img
                v-if="form.logoUrl"
                :src="form.logoUrl"
                alt="Current team logo"
                class="max-h-full max-w-full object-contain"
              >
              <UIcon
                v-else
                name="i-lucide-image"
                class="size-5 text-dimmed"
              />
            </span>
            <input
              ref="logoInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="hidden"
              @change="chooseLogo"
            >
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              :loading="uploading"
              @click="logoInput?.click()"
            >
              {{ form.logoUrl ? 'Replace logo' : 'Upload logo' }}
            </UButton>
            <UButton
              v-if="form.logoUrl"
              type="button"
              color="neutral"
              variant="ghost"
              :loading="removing"
              @click="removeLogo"
            >
              Remove
            </UButton>
          </div>
          <p class="mt-1.5 text-[12px] text-muted">
            JPG, PNG or WebP. Up to 2 MB.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Light-theme colour">
            <div class="flex items-center gap-2">
              <input
                v-model="form.brandColor"
                type="color"
                aria-label="Choose team light-theme colour"
                class="size-10 shrink-0 cursor-pointer rounded-lg border border-default bg-default p-1"
              >
              <UInput
                v-model="form.brandColor"
                class="min-w-0 flex-1 font-mono uppercase"
              />
            </div>
          </UFormField>
          <UFormField label="Dark-theme colour">
            <div class="flex items-center gap-2">
              <input
                v-model="form.brandDarkColor"
                type="color"
                aria-label="Choose team dark-theme colour"
                class="size-10 shrink-0 cursor-pointer rounded-lg border border-default bg-default p-1"
              >
              <UInput
                v-model="form.brandDarkColor"
                class="min-w-0 flex-1 font-mono uppercase"
              />
            </div>
          </UFormField>
        </div>

        <UFormField label="Booking-page theme">
          <USelectMenu
            v-model="form.bookingPageTheme"
            :items="themeOptions"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <div class="flex items-start justify-between gap-5 rounded-xl border border-default bg-muted px-4 py-3.5">
          <div>
            <p class="text-[14px] font-medium text-highlighted">
              Remove Schedra branding
            </p>
            <p class="mt-0.5 text-[12px] leading-relaxed text-muted">
              Hide “Scheduling by Schedra” on team booking pages.
            </p>
          </div>
          <USwitch
            v-model="form.hideSchedraBranding"
            aria-label="Remove Schedra branding from team pages"
          />
        </div>

        <UButton
          type="submit"
          :loading="saving"
        >
          Save branding
        </UButton>
      </form>

      <aside>
        <p class="mb-2 text-[12px] font-medium uppercase tracking-wide text-dimmed">
          Preview
        </p>
        <div
          class="overflow-hidden rounded-2xl border border-default bg-muted p-4"
          :style="previewStyle"
        >
          <div class="rounded-xl border border-default bg-default p-5 shadow-sm">
            <PersonalBookingBrand :branding="form" />
            <p class="mt-7 font-editorial text-2xl text-highlighted">
              Choose a time
            </p>
            <p class="mt-1 text-[13px] text-muted">
              Select an available slot that works for you.
            </p>
            <button
              type="button"
              class="mt-5 w-full rounded-full px-4 py-2.5 text-[13px] font-semibold"
              :style="{ backgroundColor: 'var(--preview-brand)', color: 'var(--preview-brand-contrast)' }"
            >
              Confirm booking
            </button>
          </div>
          <p
            v-if="!form.hideSchedraBranding"
            class="mt-3 text-center text-[11px] text-dimmed"
          >
            Scheduling by Schedra
          </p>
        </div>
      </aside>
    </div>
  </section>
</template>
