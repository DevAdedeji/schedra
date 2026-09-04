<script setup lang="ts">
import {
  bookingEmailTemplateOptions,
  bookingEmailTemplateSamples,
  bookingEmailTemplateSettingsSchema,
  bookingEmailVariables,
  DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS,
  renderBookingEmailTemplate,
  type BookingEmailTemplateKey,
  type BookingEmailTemplateSettings
} from '#shared/email-templates'
import { DEFAULT_PERSONAL_BRANDING, readableTextColor } from '#shared/branding'
import {
  apiErrorMessage,
  bookingEmailTemplatesApi,
  teamBookingEmailTemplatesApi,
  type BookingEmailTemplateSettingsResponse
} from '~/services/schedra-api'

const props = withDefaults(defineProps<{ teamSlug?: string, disabled?: boolean }>(), {
  disabled: false
})
const feedback = useFeedback()
const selected = ref<BookingEmailTemplateKey>('confirmation')
const saving = ref(false)
const dirty = ref(false)
const form = reactive<BookingEmailTemplateSettings>(structuredClone(DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS))
const endpoint = computed(() => props.teamSlug
  ? teamBookingEmailTemplatesApi.endpoint(props.teamSlug)
  : bookingEmailTemplatesApi.endpoint)
const { data, status, error, refresh } = await useLazyFetch<BookingEmailTemplateSettingsResponse>(endpoint)

watch(() => data.value?.settings, (value) => {
  if (!value || dirty.value) return
  Object.assign(form, structuredClone(value))
}, { immediate: true })

const canCustomize = computed(() => props.teamSlug ? true : Boolean(data.value?.entitlement?.isPro))
const current = computed(() => form.templates[selected.value])
const selectedOption = computed(() => bookingEmailTemplateOptions.find(option => option.value === selected.value)!)
const branding = computed(() => data.value?.branding ?? DEFAULT_PERSONAL_BRANDING)
const brandName = computed(() => branding.value.brandName || (props.teamSlug ? 'Your team' : 'Your brand'))
const previewColor = computed(() => branding.value.brandColor)
const preview = computed(() => renderBookingEmailTemplate(
  current.value ?? bookingEmailTemplateSamples[selected.value],
  {
    '{{guest_name}}': 'Maya',
    '{{event_name}}': 'Discovery call',
    '{{host_name}}': 'Alex',
    '{{start_time}}': 'Tuesday, 8 September 2026 at 10:00 WAT',
    '{{time_zone}}': 'Africa/Lagos'
  }
))

function toggleTemplate(enabled: boolean) {
  if (props.disabled) return
  form.templates[selected.value] = enabled
    ? structuredClone(bookingEmailTemplateSamples[selected.value])
    : null
  dirty.value = true
}

function resetAll() {
  if (props.disabled) return
  Object.assign(form, structuredClone(DEFAULT_BOOKING_EMAIL_TEMPLATE_SETTINGS))
  dirty.value = true
}

function updateFooter(value: string) {
  if (props.disabled) return
  form.footer = value || null
  dirty.value = true
}

async function save() {
  if (saving.value || props.disabled) return
  const parsed = bookingEmailTemplateSettingsSchema.safeParse(form)
  if (!parsed.success) {
    feedback.error({ title: 'Check this template', description: parsed.error.issues[0]?.message })
    return
  }
  saving.value = true
  try {
    const result = props.teamSlug
      ? await teamBookingEmailTemplatesApi.update(props.teamSlug, parsed.data)
      : await bookingEmailTemplatesApi.update(parsed.data)
    Object.assign(form, structuredClone(result.settings))
    dirty.value = false
    feedback.success({
      title: 'Email templates saved',
      description: 'New guest emails will use this wording and your saved branding.'
    })
  } catch (failure) {
    feedback.error({
      title: 'Could not save email templates',
      description: apiErrorMessage(failure, 'Check the wording and try again.')
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AsyncErrorState
    v-if="error && !data"
    title="Could not load email templates"
    description="Guests will continue receiving Schedra’s reliable default emails."
    :retrying="status === 'pending'"
    @retry="refresh"
  />

  <ListLoadingSkeleton
    v-else-if="!data"
    label="Loading email templates"
  />

  <PersonalProGate
    v-else-if="!canCustomize"
    title="Make guest emails sound like you"
    description="Personal Pro lets you customize booking emails and apply your logo and colours. Free accounts keep Schedra’s default emails."
  />

  <section
    v-else
    data-testid="booking-email-template-settings"
    class="overflow-hidden rounded-xl border border-default bg-default"
  >
    <header class="flex flex-col gap-3 border-b border-default px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-[15px] font-semibold text-highlighted">
            Guest email templates
          </h2>
          <UBadge
            v-if="!teamSlug"
            color="primary"
            variant="subtle"
          >
            Personal Pro
          </UBadge>
        </div>
        <p class="mt-1 text-[13px] leading-relaxed text-muted">
          Customize the subject and message guests receive. Booking details and action links stay accurate automatically.
        </p>
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="!dirty || disabled"
        @click="resetAll"
      >
        Reset all
      </UButton>
    </header>

    <div
      v-if="disabled"
      class="mx-5 mt-5 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[13px] leading-relaxed text-muted"
    >
      These settings are preserved but read-only while the team subscription is inactive.
    </div>

    <div class="grid gap-7 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.82fr)]">
      <form
        class="min-w-0 space-y-5"
        @input="dirty = true"
        @change="dirty = true"
        @submit.prevent="save"
      >
        <UFormField
          label="Email"
          :help="selectedOption.description"
        >
          <USelectMenu
            v-model="selected"
            :items="bookingEmailTemplateOptions"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <div class="flex items-start justify-between gap-5 rounded-xl border border-default bg-muted px-4 py-3.5">
          <div>
            <p class="text-[14px] font-medium text-highlighted">
              Custom wording
            </p>
            <p class="mt-0.5 text-[12px] leading-relaxed text-muted">
              Turn this off anytime to restore the default Schedra message.
            </p>
          </div>
          <USwitch
            :model-value="Boolean(current)"
            :aria-label="`Customize ${selectedOption.label}`"
            :disabled="disabled"
            @update:model-value="toggleTemplate"
          />
        </div>

        <template v-if="current">
          <UFormField label="Subject">
            <UInput
              v-model="current.subject"
              :maxlength="140"
              :disabled="disabled"
              class="w-full"
            />
            <template #help>
              <span class="tnum">{{ current.subject.length }}/140</span>
            </template>
          </UFormField>

          <UFormField label="Message">
            <UTextarea
              v-model="current.body"
              :rows="5"
              :maxlength="1200"
              :disabled="disabled"
              autoresize
              class="w-full"
            />
            <template #help>
              <span class="tnum">{{ current.body.length }}/1200</span>
            </template>
          </UFormField>

          <div>
            <p class="text-[12px] font-medium text-muted">
              Available variables
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="variable in bookingEmailVariables"
                :key="variable.token"
                class="rounded-md border border-default bg-muted px-2 py-1 font-mono text-[11px] text-highlighted"
                :title="variable.label"
              >{{ variable.token }}</span>
            </div>
          </div>
        </template>

        <UFormField
          label="Email footer"
          hint="Optional"
          help="Used across all guest booking emails. Leave blank to keep Schedra’s helpful default footer."
        >
          <UTextarea
            :model-value="form.footer ?? ''"
            :rows="3"
            :maxlength="240"
            :disabled="disabled"
            placeholder="Thanks for booking. We look forward to speaking with you."
            class="w-full"
            @update:model-value="updateFooter"
          />
          <template #help>
            <span class="tnum">{{ form.footer?.length ?? 0 }}/240</span>
          </template>
        </UFormField>

        <div class="flex flex-wrap items-center gap-3">
          <UButton
            type="submit"
            :loading="saving"
            :disabled="!dirty || disabled"
          >
            Save email templates
          </UButton>
          <p class="text-[12px] leading-relaxed text-muted">
            Logo, colours and the powered-by label come from the branding section above.
          </p>
        </div>
      </form>

      <aside class="min-w-0">
        <p class="mb-2 text-[12px] font-medium uppercase tracking-wide text-dimmed">
          Guest preview
        </p>
        <div class="overflow-hidden rounded-2xl bg-[#f5f5f4] p-4 sm:p-5">
          <div class="mb-4 flex min-w-0 items-center gap-2.5 px-1">
            <img
              v-if="branding.logoUrl"
              :src="branding.logoUrl"
              alt=""
              class="h-8 max-w-24 object-contain"
            >
            <span
              v-else
              class="flex size-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold"
              :style="{ backgroundColor: previewColor, color: readableTextColor(previewColor) }"
            >{{ brandName.slice(0, 1).toUpperCase() }}</span>
            <span class="truncate text-[14px] font-semibold text-stone-900">{{ brandName }}</span>
          </div>
          <div class="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
            <p class="break-words text-[12px] font-medium text-stone-500">
              {{ preview.subject }}
            </p>
            <h3 class="mt-4 text-xl font-semibold tracking-tight text-stone-900">
              {{ selectedOption.label }}
            </h3>
            <p class="mt-3 whitespace-pre-line break-words text-[14px] leading-relaxed text-stone-600">
              {{ preview.body }}
            </p>
            <div class="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-3 text-[12px] leading-relaxed text-stone-600">
              <strong class="text-stone-800">When</strong><br>
              Tuesday, 8 September 2026 at 10:00 WAT
            </div>
            <span
              class="mt-5 inline-flex rounded-lg px-4 py-2.5 text-[13px] font-semibold"
              :style="{ backgroundColor: previewColor, color: readableTextColor(previewColor) }"
            >View booking</span>
            <p
              v-if="form.footer"
              class="mt-5 border-t border-stone-200 pt-4 text-[12px] leading-relaxed text-stone-500"
            >
              {{ form.footer }}
            </p>
          </div>
          <p class="mt-3 text-center text-[11px] text-stone-500">
            <template v-if="branding.hideSchedraBranding">
              Sent by {{ brandName }}
            </template>
            <template v-else>
              Sent by {{ brandName }} · Powered by Schedra
            </template>
          </p>
        </div>
      </aside>
    </div>
  </section>
</template>
