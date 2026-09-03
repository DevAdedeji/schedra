<script setup lang="ts">
import { DEFAULT_EMAIL_NOTIFICATION_PREFERENCES } from '#shared/email-notification-preferences'
import { apiErrorMessage, emailNotificationPreferencesApi } from '~/services/schedra-api'

const feedback = useFeedback()
const saving = ref(false)
const form = reactive({ ...DEFAULT_EMAIL_NOTIFICATION_PREFERENCES })
const { data, status, error, refresh } = await useLazyFetch(emailNotificationPreferencesApi.endpoint)

watch(data, (value) => {
  if (value) Object.assign(form, value)
}, { immediate: true })

const options = [
  {
    key: 'newBookingEmails' as const,
    label: 'New bookings',
    description: 'Email me when a guest books a personal or team event assigned to me.'
  },
  {
    key: 'rescheduleEmails' as const,
    label: 'Rescheduled bookings',
    description: 'Email me when a guest moves a booking or it moves to another team host.'
  },
  {
    key: 'cancellationEmails' as const,
    label: 'Cancellations',
    description: 'Email me when a personal or team booking on my schedule is cancelled.'
  },
  {
    key: 'approvalRequestEmails' as const,
    label: 'Approval requests',
    description: 'Email me when a booking or reschedule needs my approval.'
  }
]

async function save() {
  saving.value = true
  try {
    const stored = await emailNotificationPreferencesApi.update({ ...form })
    Object.assign(form, stored)
    feedback.success({ title: 'Email preferences saved' })
  } catch (failure) {
    feedback.error({
      title: 'Could not save email preferences',
      description: apiErrorMessage(failure, 'Please try again.')
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AsyncErrorState
    v-if="error && !data"
    title="Could not load email preferences"
    description="No preferences were changed."
    :retrying="status === 'pending'"
    @retry="refresh"
  />

  <ListLoadingSkeleton
    v-else-if="status === 'pending' && !data"
    label="Loading email preferences"
  />

  <section
    v-else
    class="overflow-hidden rounded-xl border border-default bg-default"
  >
    <div class="border-b border-default px-6 py-5 sm:px-7">
      <h2 class="text-[16px] font-semibold text-highlighted">
        Email notifications
      </h2>
      <p class="mt-1 text-[14px] text-muted">
        Choose which optional host updates arrive by email.
      </p>
    </div>

    <form
      class="px-6 py-6 sm:px-7"
      @submit.prevent="save"
    >
      <div class="divide-y divide-default">
        <label
          v-for="option in options"
          :key="option.key"
          class="flex cursor-pointer items-start justify-between gap-5 py-4 first:pt-0 last:pb-0"
        >
          <span class="min-w-0">
            <span class="block text-[14px] font-medium text-highlighted">{{ option.label }}</span>
            <span class="mt-1 block text-[13px] leading-5 text-muted">{{ option.description }}</span>
          </span>
          <USwitch
            v-model="form[option.key]"
            :aria-label="option.label"
            class="mt-0.5 shrink-0"
          />
        </label>
      </div>

      <div class="mt-6 rounded-lg border border-default bg-muted/40 px-4 py-3 text-[13px] leading-5 text-muted">
        Guest confirmations and reminders always continue. Account security, verification, billing, payment, refund and service notices cannot be turned off here.
      </div>

      <UButton
        type="submit"
        size="lg"
        :loading="saving"
        class="mt-5 font-medium"
      >
        Save email preferences
      </UButton>
    </form>
  </section>
</template>
