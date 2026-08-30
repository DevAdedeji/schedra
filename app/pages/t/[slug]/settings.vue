<script setup lang="ts">
import { organizationNameSchema, organizationSlugSchema } from '#shared/billing'
import {
  apiErrorMessage,
  teamsApi,
  type SlugAvailability,
  type TeamDetail,
  type TeamMembersResponse
} from '~/services/schedra-api'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'

definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const authClient = useAuthClient()
const feedback = useFeedback()
const { host } = useSiteUrl()

const { data: team, refresh: refreshTeam, error: loadFailure }
  = await useLazyFetch<TeamDetail>(() => teamsApi.detailEndpoint(slug.value))

useSeoMeta({
  title: () => team.value ? `${team.value.organization.name} settings` : 'Team settings',
  robots: 'noindex, nofollow'
})

const permissions = computed(() => team.value?.permissions)
const entitlement = computed(() => team.value?.entitlement)

const name = ref('')
const address = ref('')
watch(team, (value) => {
  if (!value) return
  name.value = value.organization.name
  address.value = value.organization.slug
}, { immediate: true })

const savingProfile = ref(false)
const nameDirty = computed(() => name.value.trim() !== team.value?.organization.name)
const nameValid = computed(() => organizationNameSchema.safeParse(name.value).success)
const checking = ref(false)
const availability = ref<SlugAvailability | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined
let request = 0

const addressDirty = computed(() => address.value !== team.value?.organization.slug)

watch(address, (value) => {
  const current = ++request
  availability.value = null
  clearTimeout(debounce)
  checking.value = false
  if (!addressDirty.value || value.length < 2) return

  checking.value = true
  debounce = setTimeout(async () => {
    try {
      const result = await teamsApi.slugAvailable(value)
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
const profileDirty = computed(() => nameDirty.value || addressDirty.value)
const profileValid = computed(() =>
  (!nameDirty.value || nameValid.value)
  && (!addressDirty.value || addressValid.value)
)

async function saveProfile() {
  if (!profileDirty.value || !profileValid.value || savingProfile.value) return
  savingProfile.value = true
  try {
    if (nameDirty.value) {
      const result = await authClient.organization.update({
        organizationId: team.value?.organization.id,
        data: { name: name.value.trim() }
      })
      if (result.error) throw new Error(result.error.message ?? 'Could not update this team.')
    }

    const result = addressDirty.value
      ? await teamsApi.updateAddress(slug.value, address.value)
      : null

    feedback.success({
      title: 'Team profile saved',
      description: result ? 'The old public address will continue to work.' : undefined
    })
    if (result) await navigateTo(`/t/${result.slug}/settings`)
    else await refreshTeam()
  } catch (failure) {
    feedback.error({ title: 'Could not save team profile', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    savingProfile.value = false
  }
}

const transferring = ref(false)
const transferTarget = ref('')
const {
  query: transferSearchInput,
  search: transferSearch,
  clearSearch: clearTransferSearch
} = useDebouncedSearch()
const transferBusy = ref(false)

const transferMembersQuery = computed(() => ({ pageSize: DEFAULT_LIST_PAGE_SIZE, search: transferSearch.value }))
const { data: members, refresh: refreshMembers } = await useLazyFetch<TeamMembersResponse>(
  () => teamsApi.membersEndpoint(slug.value),
  { query: transferMembersQuery, immediate: false }
)

watch(transferring, (open) => {
  if (open) refreshMembers()
  else {
    transferTarget.value = ''
    clearTransferSearch()
  }
})

const transferOptions = computed(() => (members.value?.items ?? [])
  .filter(member => !member.isYou)
  .map(member => ({ label: `${member.name} · ${member.email}`, value: member.id })))

async function transfer() {
  if (!transferTarget.value || transferBusy.value) return
  transferBusy.value = true
  try {
    await teamsApi.transferOwnership(slug.value, transferTarget.value)
    feedback.success({
      title: 'Ownership transferred',
      description: 'You are now an admin of this team.'
    })
    transferring.value = false
    transferTarget.value = ''
    await refreshTeam()
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
    const result = await teamsApi.archive(slug.value, archiveConfirmation.value.trim())
    feedback.success({
      title: 'Team archived',
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
      organizationId: team.value?.organization.id ?? ''
    })
    if (result.error) throw new Error(result.error.message ?? 'Could not leave this team.')
    feedback.success({ title: 'You left the team' })
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
      title="Team settings"
      description="Manage your team's identity, public address and ownership."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          :to="`/t/${slug}/members`"
        >
          Members
        </UButton>
      </template>
    </PageHeader>

    <AsyncErrorState
      v-if="loadFailure && !team"
      title="Could not load this team"
      description="It may have been archived, or your access may have changed."
      @retry="refreshTeam"
    />

    <template v-else-if="team">
      <section
        v-if="entitlement && permissions?.manageBilling"
        class="flex flex-col gap-4 rounded-xl border border-default bg-default px-5 py-5 sm:flex-row sm:items-center"
      >
        <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UIcon
            name="i-lucide-credit-card"
            class="size-4.5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-[15px] font-semibold text-highlighted">
              Billing and plan
            </h2>
            <UBadge
              :color="entitlement.status === 'active' ? 'success' : entitlement.status === 'trialing' ? 'info' : 'error'"
              variant="subtle"
              class="capitalize"
            >
              {{ entitlement.status.replace('_', ' ') }}
            </UBadge>
          </div>
          <p class="mt-1 text-[13px] leading-relaxed text-muted">
            <template v-if="entitlement.status === 'trialing'">
              {{ entitlement.daysLeftInTrial }} days remain in the trial.
            </template>
            <template v-else-if="entitlement.readOnly">
              The team is read-only until billing is restored.
            </template>
            <template v-else>
              {{ entitlement.seatsUsed }} active {{ entitlement.seatsUsed === 1 ? 'member' : 'members' }} on the {{ entitlement.interval }} plan.
            </template>
          </p>
        </div>
        <UButton
          :to="`/t/${slug}/billing`"
          color="neutral"
          variant="outline"
          trailing-icon="i-lucide-arrow-right"
          class="shrink-0"
        >
          Manage billing
        </UButton>
      </section>

      <section
        v-if="permissions?.updateTeam || permissions?.changeAddress"
        class="overflow-hidden rounded-xl border border-default bg-default"
      >
        <header class="border-b border-default px-5 py-4">
          <h2 class="text-[15px] font-semibold text-highlighted">
            Team profile
          </h2>
          <p class="mt-1 text-[13px] text-muted">
            The name and address people see on your public team booking page.
          </p>
        </header>

        <div
          v-if="permissions?.updateTeam"
          class="px-5 py-5"
        >
          <UFormField
            label="Team name"
            help="Shown to members and guests."
            class="min-w-0 flex-1"
          >
            <UInput
              v-model="name"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <div
          v-if="permissions?.changeAddress"
          class="border-t border-default px-5 py-5"
        >
          <UFormField
            label="Public address"
            help="Old links continue to work after a change."
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
              class="mt-1.5 text-[13px] text-error"
            >
              {{ availability.message }}
            </p>
          </UFormField>
        </div>
        <footer class="flex justify-end border-t border-default bg-muted/30 px-5 py-4">
          <UButton
            :loading="savingProfile"
            :disabled="!profileDirty || !profileValid"
            @click="saveProfile"
          >
            Save changes
          </UButton>
        </footer>
      </section>

      <TeamBrandingSettings
        v-if="permissions?.updateTeam"
        :team-slug="slug"
        :team-name="team.organization.name"
      />

      <section class="overflow-hidden rounded-xl border border-default bg-default">
        <header class="border-b border-default px-5 py-4">
          <h2 class="text-[15px] font-semibold text-highlighted">
            Your membership
          </h2>
        </header>
        <div class="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
          <div class="min-w-0 flex-1">
            <p class="text-[14px] text-muted">
              You are {{ team.role === 'owner' ? 'the owner' : `an ${team.role}` }} of this team.
              Leaving does not touch your personal booking page, schedules or calendar.
            </p>
            <p
              v-if="team.role === 'owner'"
              class="mt-2 text-[13px] text-muted"
            >
              An owner cannot leave. Transfer ownership first, or archive the team.
            </p>
          </div>

          <div class="flex shrink-0 flex-wrap gap-2 sm:justify-end">
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
              v-if="team.role !== 'owner'"
              color="error"
              variant="outline"
              icon="i-lucide-log-out"
              :loading="leaving"
              @click="leave"
            >
              Leave team
            </UButton>
          </div>
        </div>
      </section>

      <section
        v-if="permissions?.archiveTeam"
        class="overflow-hidden rounded-xl border border-error/30 bg-default"
      >
        <header class="border-b border-error/20 px-5 py-4">
          <h2 class="text-[15px] font-semibold text-highlighted">
            Archive team
          </h2>
        </header>
        <div class="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
          <p class="min-w-0 flex-1 text-[14px] leading-relaxed text-muted">
            Archiving closes the team for everyone and cancels upcoming team bookings, notifying their guests.
            Nothing is deleted — bookings, history and exports are retained, and the address stays reserved so
            nobody else can claim it.
          </p>
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-archive"
            class="shrink-0 self-start sm:self-auto"
            @click="archiving = true"
          >
            Archive this team
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
            v-model:search-term="transferSearchInput"
            :items="transferOptions"
            value-key="value"
            :ignore-filter="true"
            placeholder="Choose a member"
            aria-label="New owner"
            size="lg"
            class="w-full"
          />
        </UFormField>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="transferBusy"
              @click="transferring = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              :loading="transferBusy"
              :disabled="!transferTarget"
              @click="transfer"
            >
              Transfer
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>

    <UModal
      v-model:open="archiving"
      title="Archive this team"
      description="This closes it for everyone. Data is kept, not deleted."
      :ui="{ content: 'w-full max-w-md', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <UFormField
          :label="`Type ${team?.organization.slug} to confirm`"
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
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="archiveBusy"
              @click="archiving = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              color="error"
              :loading="archiveBusy"
              :disabled="archiveConfirmation.trim() !== team?.organization.slug"
              @click="archive"
            >
              Archive team
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>
  </div>
</template>
