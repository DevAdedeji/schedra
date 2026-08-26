<script setup lang="ts">
import { TEAM_PLAN, formatUsd, organizationNameSchema, organizationSlugSchema } from '#shared/billing'
import {
  apiErrorMessage,
  workspacesApi,
  type SlugAvailability,
  type WorkspaceDetail,
  type WorkspaceMembersResponse
} from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const authClient = useAuthClient()
const feedback = useFeedback()
const { host } = useSiteUrl()

const { data: workspace, refresh: refreshWorkspace, error: loadFailure }
  = await useLazyFetch<WorkspaceDetail>(() => workspacesApi.detailEndpoint(slug.value))

useSeoMeta({
  title: () => workspace.value ? `${workspace.value.organization.name} settings` : 'Workspace settings',
  robots: 'noindex, nofollow'
})

const permissions = computed(() => workspace.value?.permissions)
const entitlement = computed(() => workspace.value?.entitlement)

const name = ref('')
const address = ref('')
watch(workspace, (value) => {
  if (!value) return
  name.value = value.organization.name
  address.value = value.organization.slug
}, { immediate: true })

const savingName = ref(false)
const nameDirty = computed(() => name.value.trim() !== workspace.value?.organization.name)
const nameValid = computed(() => organizationNameSchema.safeParse(name.value).success)

async function saveName() {
  if (!nameValid.value || savingName.value) return
  savingName.value = true
  try {
    const result = await authClient.organization.update({
      organizationId: workspace.value?.organization.id,
      data: { name: name.value.trim() }
    })
    if (result.error) throw new Error(result.error.message ?? 'Could not rename this workspace.')
    feedback.success({ title: 'Workspace renamed' })
    await refreshWorkspace()
  } catch (failure) {
    feedback.error({ title: 'Could not rename', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    savingName.value = false
  }
}

const savingAddress = ref(false)
const checking = ref(false)
const availability = ref<SlugAvailability | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined
let request = 0

const addressDirty = computed(() => address.value !== workspace.value?.organization.slug)

watch(address, (value) => {
  const current = ++request
  availability.value = null
  clearTimeout(debounce)
  checking.value = false
  if (!addressDirty.value || value.length < 2) return

  checking.value = true
  debounce = setTimeout(async () => {
    try {
      const result = await workspacesApi.slugAvailable(value)
      if (current === request && value === address.value) availability.value = result
    } catch {
      if (current === request) availability.value = null
    } finally {
      if (current === request) checking.value = false
    }
  }, 350)
})
onBeforeUnmount(() => clearTimeout(debounce))

const addressState = computed<'ok' | 'bad' | 'busy' | null>(() => {
  if (!addressDirty.value || address.value.length < 2) return null
  if (checking.value) return 'busy'
  if (!availability.value) return null
  return availability.value.available ? 'ok' : 'bad'
})

const addressValid = computed(() =>
  organizationSlugSchema.safeParse(address.value).success && availability.value?.available === true
)

async function saveAddress() {
  if (!addressValid.value || savingAddress.value) return
  savingAddress.value = true
  try {
    const result = await workspacesApi.updateAddress(slug.value, address.value)
    feedback.success({
      title: 'Address changed',
      description: 'Links using the old address still work.'
    })
    await navigateTo(`/w/${result.slug}/settings`)
  } catch (failure) {
    feedback.error({ title: 'Could not change address', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    savingAddress.value = false
  }
}

const transferring = ref(false)
const transferTarget = ref('')
const transferBusy = ref(false)
const { data: members, refresh: refreshMembers } = await useLazyFetch<WorkspaceMembersResponse>(
  () => workspacesApi.membersEndpoint(slug.value),
  { query: { pageSize: 50 }, immediate: false }
)

watch(transferring, (open) => {
  if (open) refreshMembers()
})

const transferOptions = computed(() => (members.value?.items ?? [])
  .filter(member => !member.isYou)
  .map(member => ({ label: `${member.name} · ${member.email}`, value: member.id })))

async function transfer() {
  if (!transferTarget.value || transferBusy.value) return
  transferBusy.value = true
  try {
    await workspacesApi.transferOwnership(slug.value, transferTarget.value)
    feedback.success({
      title: 'Ownership transferred',
      description: 'You are now an admin of this workspace.'
    })
    transferring.value = false
    transferTarget.value = ''
    await refreshWorkspace()
  } catch (failure) {
    feedback.error({ title: 'Could not transfer', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    transferBusy.value = false
  }
}

const archiving = ref(false)
const archiveConfirmation = ref('')
const archiveBusy = ref(false)

async function archive() {
  if (archiveBusy.value) return
  archiveBusy.value = true
  try {
    const result = await workspacesApi.archive(slug.value, archiveConfirmation.value.trim())
    feedback.success({
      title: 'Workspace archived',
      description: result.cancelledBookings
        ? `${result.cancelledBookings} upcoming booking(s) were cancelled and guests notified.`
        : 'Its data is retained and exportable.'
    })
    await navigateTo('/dashboard')
  } catch (failure) {
    feedback.error({ title: 'Could not archive', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    archiveBusy.value = false
  }
}

const leaving = ref(false)
async function leave() {
  if (leaving.value) return
  leaving.value = true
  try {
    const result = await authClient.organization.leave({
      organizationId: workspace.value?.organization.id ?? ''
    })
    if (result.error) throw new Error(result.error.message ?? 'Could not leave this workspace.')
    feedback.success({ title: 'You left the workspace' })
    await navigateTo('/dashboard')
  } catch (failure) {
    feedback.error({ title: 'Could not leave', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Workspace settings"
      :description="workspace?.organization.name"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          :to="`/w/${slug}/members`"
        >
          Members
        </UButton>
      </template>
    </PageHeader>

    <AsyncErrorState
      v-if="loadFailure && !workspace"
      title="Could not load this workspace"
      description="It may have been archived, or your access may have changed."
      @retry="refreshWorkspace"
    />

    <template v-else-if="workspace">
      <section
        v-if="entitlement && permissions?.manageBilling"
        class="overflow-hidden rounded-xl border border-default bg-default"
      >
        <header class="border-b border-default px-5 py-4">
          <h2 class="text-[14px] font-semibold text-highlighted">
            Plan
          </h2>
        </header>
        <div class="space-y-4 px-5 py-5">
          <div class="flex flex-wrap items-center gap-3">
            <UBadge
              :color="entitlement.status === 'active' ? 'success' : entitlement.status === 'trialing' ? 'info' : 'error'"
              variant="subtle"
            >
              {{ entitlement.status.replace('_', ' ') }}
            </UBadge>
            <p class="text-[13px] text-muted">
              <template v-if="entitlement.status === 'trialing'">
                {{ entitlement.daysLeftInTrial }} days left in your trial.
              </template>
              <template v-else-if="entitlement.readOnly">
                Read-only until the subscription is renewed.
              </template>
              <template v-else-if="entitlement.currentPeriodEnd">
                Renews {{ new Date(entitlement.currentPeriodEnd).toLocaleDateString() }}.
              </template>
            </p>
          </div>

          <dl class="grid gap-4 sm:grid-cols-3">
            <div>
              <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                Members billed
              </dt>
              <dd class="mt-1 text-[15px] font-medium text-highlighted">
                {{ entitlement.seatsUsed }}
                <span
                  v-if="entitlement.seatsUsed < TEAM_PLAN.minimumSeats"
                  class="text-[12px] font-normal text-muted"
                >
                  (billed at the {{ TEAM_PLAN.minimumSeats }}-member minimum)
                </span>
              </dd>
            </div>
            <div>
              <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                Per member
              </dt>
              <dd class="mt-1 text-[15px] font-medium text-highlighted">
                {{ formatUsd(entitlement.interval === 'yearly' ? TEAM_PLAN.yearlyCentsPerSeat : TEAM_PLAN.monthlyCentsPerSeat) }}
                <span class="text-[12px] font-normal text-muted">/{{ entitlement.interval === 'yearly' ? 'year' : 'month' }}</span>
              </dd>
            </div>
            <div>
              <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                Next invoice
              </dt>
              <dd class="mt-1 text-[15px] font-medium text-highlighted">
                {{ formatUsd(entitlement.nextInvoiceCents) }}
              </dd>
            </div>
          </dl>

          <p class="text-[12px] leading-relaxed text-muted">
            You are billed only for members who have actually joined — pending invitations cost nothing.
          </p>
        </div>
      </section>

      <section
        v-if="permissions?.updateWorkspace"
        class="overflow-hidden rounded-xl border border-default bg-default"
      >
        <header class="border-b border-default px-5 py-4">
          <h2 class="text-[14px] font-semibold text-highlighted">
            Name
          </h2>
        </header>
        <div class="flex flex-wrap items-end gap-3 px-5 py-5">
          <UFormField
            label="Workspace name"
            class="min-w-0 flex-1"
          >
            <UInput
              v-model="name"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <UButton
            :loading="savingName"
            :disabled="!nameDirty || !nameValid"
            @click="saveName"
          >
            Save
          </UButton>
        </div>
      </section>

      <section
        v-if="permissions?.changeAddress"
        class="overflow-hidden rounded-xl border border-default bg-default"
      >
        <header class="border-b border-default px-5 py-4">
          <h2 class="text-[14px] font-semibold text-highlighted">
            Address
          </h2>
          <p class="mt-1 text-[12px] text-muted">
            Links shared with the old address keep working.
          </p>
        </header>
        <div class="flex flex-wrap items-end gap-3 px-5 py-5">
          <UFormField
            label="Public address"
            class="min-w-0 flex-1"
          >
            <UsernameField
              v-model="address"
              size="lg"
              :prefix="`${host}/team/`"
              :state="addressState"
            />
            <p
              v-if="availability && !availability.available"
              class="mt-1.5 text-[12px] text-error"
            >
              {{ availability.message }}
            </p>
          </UFormField>
          <UButton
            :loading="savingAddress"
            :disabled="!addressDirty || !addressValid"
            @click="saveAddress"
          >
            Change
          </UButton>
        </div>
      </section>

      <section class="overflow-hidden rounded-xl border border-default bg-default">
        <header class="border-b border-default px-5 py-4">
          <h2 class="text-[14px] font-semibold text-highlighted">
            Your membership
          </h2>
        </header>
        <div class="space-y-4 px-5 py-5">
          <p class="text-[13px] text-muted">
            You are {{ workspace.role === 'owner' ? 'the owner' : `an ${workspace.role}` }} of this workspace.
            Leaving does not touch your personal booking page, schedules or calendar.
          </p>

          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="permissions?.transferOwnership"
              color="neutral"
              variant="outline"
              icon="i-lucide-user-round-cog"
              @click="transferring = true"
            >
              Transfer ownership
            </UButton>
            <UButton
              v-if="workspace.role !== 'owner'"
              color="error"
              variant="outline"
              icon="i-lucide-log-out"
              :loading="leaving"
              @click="leave"
            >
              Leave workspace
            </UButton>
          </div>

          <p
            v-if="workspace.role === 'owner'"
            class="text-[12px] text-muted"
          >
            An owner cannot leave. Transfer ownership first, or archive the workspace.
          </p>
        </div>
      </section>

      <section
        v-if="permissions?.archiveWorkspace"
        class="overflow-hidden rounded-xl border border-error/30 bg-default"
      >
        <header class="border-b border-error/20 px-5 py-4">
          <h2 class="text-[14px] font-semibold text-highlighted">
            Archive workspace
          </h2>
        </header>
        <div class="space-y-4 px-5 py-5">
          <p class="text-[13px] leading-relaxed text-muted">
            Archiving closes the workspace for everyone and cancels upcoming team bookings, notifying their guests.
            Nothing is deleted — bookings, history and exports are retained, and the address stays reserved so
            nobody else can claim it.
          </p>
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-archive"
            @click="archiving = true"
          >
            Archive this workspace
          </UButton>
        </div>
      </section>
    </template>

    <UModal
      v-model:open="transferring"
      title="Transfer ownership"
      description="The new owner gets full control. You become an admin."
      :ui="{ content: 'w-full max-w-md', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <UFormField
          label="New owner"
          class="px-1 py-1"
        >
          <USelectMenu
            v-model="transferTarget"
            :items="transferOptions"
            value-key="value"
            placeholder="Choose a member"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="transferBusy"
            @click="transferring = false"
          >
            Cancel
          </UButton>
          <UButton
            :loading="transferBusy"
            :disabled="!transferTarget"
            @click="transfer"
          >
            Transfer
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="archiving"
      title="Archive this workspace"
      description="This closes it for everyone. Data is kept, not deleted."
      :ui="{ content: 'w-full max-w-md', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <UFormField
          :label="`Type ${workspace?.organization.slug} to confirm`"
          class="px-1 py-1"
        >
          <UInput
            v-model="archiveConfirmation"
            size="lg"
            autocomplete="off"
            class="w-full"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="archiveBusy"
            @click="archiving = false"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            :loading="archiveBusy"
            :disabled="archiveConfirmation.trim() !== workspace?.organization.slug"
            @click="archive"
          >
            Archive workspace
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
