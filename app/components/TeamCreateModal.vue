<script setup lang="ts">
import { createOrganizationSchema, TEAM_PLAN, formatUsd } from '#shared/billing'
import { apiErrorMessage, teamsApi, type SlugAvailability } from '~/services/schedra-api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'created': [slug: string] }>()

const authClient = useAuthClient()
const { host } = useSiteUrl()
const feedback = useFeedback()

const form = reactive({ name: '', slug: '' })
const slugTouched = ref(false)
const saving = ref(false)
const error = ref('')

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })

const checking = ref(false)
const availability = ref<SlugAvailability | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined
let request = 0

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

watch(() => form.name, (value) => {
  if (!slugTouched.value) form.slug = slugify(value)
})

watch(() => form.slug, (value) => {
  const current = ++request
  availability.value = null
  clearTimeout(debounce)
  checking.value = false
  if (value.length < 2) return

  checking.value = true
  debounce = setTimeout(async () => {
    try {
      const result = await teamsApi.slugAvailable(value)
      if (current === request && value === form.slug) availability.value = result
    } catch {
      if (current === request) availability.value = null
    } finally {
      if (current === request) checking.value = false
    }
  }, 350)
})

watch(isOpen, (open) => {
  if (open) return
  form.name = ''
  form.slug = ''
  slugTouched.value = false
  error.value = ''
  availability.value = null
})

onBeforeUnmount(() => clearTimeout(debounce))

const addressState = computed<'ok' | 'bad' | 'busy' | null>(() => {
  if (form.slug.length < 2) return null
  if (checking.value) return 'busy'
  if (!availability.value) return null
  return availability.value.available ? 'ok' : 'bad'
})

const valid = computed(() =>
  createOrganizationSchema.safeParse(form).success && availability.value?.available === true
)

async function create() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''

  try {
    const result = await authClient.organization.create({ name: form.name, slug: form.slug })
    if (result.error) throw new Error(result.error.message ?? 'Could not create that team.')

    feedback.success({
      title: `${form.name} is ready`,
      description: `Your ${TEAM_PLAN.trialDays}-day trial has started. Invite your team to get going.`
    })
    emit('created', form.slug)
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not create that team.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="Create a team"
    description="Share booking links your whole team can host."
    :ui="{ content: 'w-full max-w-lg', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
  >
    <template #body>
      <form
        id="team-create-form"
        class="space-y-5 px-1 py-1"
        @submit.prevent="create"
      >
        <UFormField
          label="Team name"
          name="name"
          required
        >
          <UInput
            v-model="form.name"
            placeholder="Acme Design"
            size="lg"
            autofocus
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Team address"
          name="slug"
          required
          :help="`This is where your team's public booking links live.`"
        >
          <UsernameField
            v-model="form.slug"
            size="lg"
            placeholder="acme"
            :prefix="`${host}/team/`"
            :state="addressState"
            @update:model-value="slugTouched = true"
          />
          <p
            v-if="availability && !availability.available"
            class="mt-1.5 text-[12px] text-error"
          >
            {{ availability.message }}
          </p>
        </UFormField>

        <div class="rounded-xl border border-default bg-muted/50 p-4">
          <div class="flex items-start gap-3">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon
                name="i-lucide-sparkles"
                class="size-4"
              />
            </span>
            <div class="min-w-0 text-[12px] leading-relaxed text-muted">
              <p class="font-medium text-highlighted">
                {{ TEAM_PLAN.trialDays }} days free, no card needed
              </p>
              <p class="mt-1">
                After the trial it is {{ formatUsd(TEAM_PLAN.monthlyCentsPerSeat) }} per member each month,
                billed only for members who have actually joined. Your personal booking page stays free.
              </p>
            </div>
          </div>
        </div>

        <p
          v-if="error"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="saving"
          @click="isOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          type="submit"
          form="team-create-form"
          :loading="saving"
          :disabled="!valid"
        >
          Create team
        </UButton>
      </div>
    </template>
  </UModal>
</template>
