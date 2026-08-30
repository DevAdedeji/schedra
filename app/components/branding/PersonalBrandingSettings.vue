<script setup lang="ts">
import { DEFAULT_PERSONAL_BRANDING, readableTextColor, type BookingPageTheme } from '#shared/branding'
import { apiErrorMessage, brandingApi } from '~/services/schedra-api'

const feedback = useFeedback()
const logoInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const uploading = ref(false)
const removing = ref(false)
const form = reactive({ ...DEFAULT_PERSONAL_BRANDING, brandName: DEFAULT_PERSONAL_BRANDING.brandName ?? '' })

const { data, status, error, refresh } = await useLazyFetch(brandingApi.endpoint)
const entitlement = computed(() => data.value?.entitlement)
const canBrand = computed(() => Boolean(entitlement.value?.isPro))

watch(() => data.value?.branding, (value) => {
  if (value) Object.assign(form, value, { brandName: value.brandName ?? '' })
}, { immediate: true })

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
  saving.value = true
  try {
    const result = await brandingApi.update({
      brandName: form.brandName || null,
      brandColor: form.brandColor,
      brandDarkColor: form.brandDarkColor,
      bookingPageTheme: form.bookingPageTheme,
      hideSchedraBranding: form.hideSchedraBranding
    })
    Object.assign(form, result.branding)
    feedback.success({ title: 'Branding saved', description: 'Your public booking pages now use these settings.' })
  } catch (failure) {
    feedback.error({ title: 'Could not save branding', description: apiErrorMessage(failure, 'Check the colours and try again.') })
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
    const result = await brandingApi.uploadLogo(file)
    form.logoUrl = result.logoUrl
    feedback.success({ title: 'Logo updated' })
  } catch (failure) {
    feedback.error({ title: 'Could not upload logo', description: apiErrorMessage(failure, 'Use a JPG, PNG or WebP file under 2 MB.') })
  } finally {
    uploading.value = false
  }
}

async function removeLogo() {
  removing.value = true
  try {
    await brandingApi.removeLogo()
    form.logoUrl = null
    feedback.success({ title: 'Logo removed' })
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
    title="Could not load branding"
    description="Your existing booking page is unchanged."
    :retrying="status === 'pending'"
    @retry="refresh"
  />

  <ListLoadingSkeleton
    v-else-if="status === 'pending' && !data"
    label="Loading branding settings"
  />

  <PersonalProGate
    v-else-if="!canBrand"
    title="Make the booking page yours"
    description="Add your business logo and colours, choose the page theme, and remove Schedra branding with Personal Pro."
  />

  <section
    v-else
    class="overflow-hidden rounded-xl border border-default bg-default"
  >
    <div class="border-b border-default px-6 py-5 sm:px-7">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-[16px] font-semibold text-highlighted">
          Booking-page branding
        </h2>
        <UBadge
          color="primary"
          variant="subtle"
        >
          Personal Pro
        </UBadge>
      </div>
      <p class="mt-1 text-[14px] text-muted">
        Applied to your personal profile, event pages and embedded booking flow.
      </p>
    </div>

    <div class="grid gap-7 px-6 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <form
        class="space-y-5"
        @submit.prevent="save"
      >
        <div>
          <p class="text-[14px] font-medium text-highlighted">
            Company logo
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <span class="flex h-14 w-28 items-center justify-center overflow-hidden rounded-lg border border-default bg-muted p-2">
              <img
                v-if="form.logoUrl"
                :src="form.logoUrl"
                alt="Current company logo"
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

        <UFormField
          label="Brand name"
          hint="Optional"
        >
          <UInput
            v-model="form.brandName"
            :maxlength="80"
            placeholder="Your business or practice"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Light-theme colour">
            <div class="flex items-center gap-2">
              <input
                v-model="form.brandColor"
                type="color"
                aria-label="Choose light-theme brand colour"
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
                aria-label="Choose dark-theme brand colour"
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
              Hide “Scheduling by Schedra” from your public and embedded booking pages.
            </p>
          </div>
          <USwitch
            v-model="form.hideSchedraBranding"
            aria-label="Remove Schedra branding"
          />
        </div>

        <UButton
          type="submit"
          :loading="saving"
          class="font-medium"
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
            <div class="flex min-h-9 items-center gap-2.5">
              <img
                v-if="form.logoUrl"
                :src="form.logoUrl"
                alt=""
                class="max-h-9 max-w-28 object-contain object-left"
              >
              <span
                v-if="form.brandName"
                class="truncate text-[14px] font-semibold text-highlighted"
              >{{ form.brandName }}</span>
              <SchedraMark v-if="!form.logoUrl && !form.brandName" />
            </div>
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
