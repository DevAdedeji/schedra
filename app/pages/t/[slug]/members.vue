<script setup lang="ts">
import { TEAM_PLAN, formatUsd, invitableRoles, type InvitableRole, type OrganizationRole } from '#shared/billing'
import {
  apiErrorMessage,
  workspacesApi,
  type WorkspaceDetail,
  type WorkspaceInvitationsResponse,
  type WorkspaceMemberRecord,
  type WorkspaceMembersResponse
} from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const authClient = useAuthClient()
const feedback = useFeedback()

const { data: workspace, refresh: refreshWorkspace, error: workspaceFailure }
  = await useLazyFetch<WorkspaceDetail>(() => workspacesApi.detailEndpoint(slug.value))

useSeoMeta({
  title: () => workspace.value ? `${workspace.value.organization.name} members` : 'Workspace members',
  robots: 'noindex, nofollow'
})

const filter = ref<'all' | 'owner' | 'admin' | 'member'>('all')
const query = ref('')
const search = ref('')
const page = ref(1)

const membersQuery = computed(() => ({
  filter: filter.value, search: search.value, page: page.value, pageSize: 10
}))
const { data: members, refresh: refreshMembers, status, error: membersFailure }
  = await useLazyFetch<WorkspaceMembersResponse>(() => workspacesApi.membersEndpoint(slug.value), { query: membersQuery })

const { data: invitations, refresh: refreshInvitations }
  = await useLazyFetch<WorkspaceInvitationsResponse>(() => workspacesApi.invitationsEndpoint(slug.value), {
    query: { pageSize: 50 },
    immediate: false
  })

const permissions = computed(() => workspace.value?.permissions)
const entitlement = computed(() => workspace.value?.entitlement)
const list = computed(() => members.value?.items ?? [])
const pendingInvites = computed(() => invitations.value?.items ?? [])
const initialLoading = computed(() => status.value === 'pending' && !members.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(members.value))
const blockingFailure = computed(() => Boolean((membersFailure.value || workspaceFailure.value) && !members.value))

watch(() => permissions.value?.inviteMembers, (allowed) => {
  if (allowed) refreshInvitations()
}, { immediate: true })

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
    page.value = 1
  }, 250)
})
watch(filter, () => {
  page.value = 1
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const filterOptions = computed(() => [
  { value: 'all', label: 'All', count: members.value?.counts.all ?? 0 },
  { value: 'owner', label: 'Owners', count: members.value?.counts.owner ?? 0 },
  { value: 'admin', label: 'Admins', count: members.value?.counts.admin ?? 0 },
  { value: 'member', label: 'Members', count: members.value?.counts.member ?? 0 }
])

const inviting = ref(false)
const inviteEmail = ref('')
const inviteRole = ref<InvitableRole>('member')
const inviteError = ref('')
const sending = ref(false)
const busyId = ref('')

const roleOptions = invitableRoles.map(role => ({
  label: role === 'admin' ? 'Admin' : 'Member',
  value: role
}))

function initials(name: string) {
  return name.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

const roleColor: Record<OrganizationRole, 'primary' | 'info' | 'neutral'> = {
  owner: 'primary',
  admin: 'info',
  member: 'neutral'
}

async function sendInvite() {
  if (sending.value) return
  sending.value = true
  inviteError.value = ''

  try {
    const result = await authClient.organization.inviteMember({
      email: inviteEmail.value.trim().toLowerCase(),
      role: inviteRole.value,
      organizationId: workspace.value?.organization.id
    })
    if (result.error) throw new Error(result.error.message ?? 'Could not send that invitation.')

    feedback.success({
      title: 'Invitation sent',
      description: `${inviteEmail.value.trim()} has ${TEAM_PLAN.invitationExpiryDays} days to accept.`
    })
    inviteEmail.value = ''
    inviteRole.value = 'member'
    inviting.value = false
    await Promise.all([refreshInvitations(), refreshWorkspace()])
  } catch (failure) {
    inviteError.value = apiErrorMessage(failure, 'Could not send that invitation.')
  } finally {
    sending.value = false
  }
}

async function revokeInvite(id: string, email: string) {
  busyId.value = id
  try {
    const result = await authClient.organization.cancelInvitation({ invitationId: id })
    if (result.error) throw new Error(result.error.message ?? 'Could not revoke that invitation.')
    feedback.success({ title: 'Invitation revoked', description: `${email} can no longer join with that link.` })
    await refreshInvitations()
  } catch (failure) {
    feedback.error({ title: 'Could not revoke', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    busyId.value = ''
  }
}

async function changeRole(member: WorkspaceMemberRecord, role: InvitableRole) {
  busyId.value = member.id
  try {
    const result = await authClient.organization.updateMemberRole({
      memberId: member.id,
      role,
      organizationId: workspace.value?.organization.id
    })
    if (result.error) throw new Error(result.error.message ?? 'Could not change that role.')
    feedback.success({ title: 'Role updated', description: `${member.name} is now ${role === 'admin' ? 'an admin' : 'a member'}.` })
    await refreshMembers()
  } catch (failure) {
    feedback.error({ title: 'Could not change role', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    busyId.value = ''
  }
}

async function removeMember(member: WorkspaceMemberRecord) {
  busyId.value = member.id
  try {
    const result = await authClient.organization.removeMember({
      memberIdOrEmail: member.id,
      organizationId: workspace.value?.organization.id
    })
    if (result.error) throw new Error(result.error.message ?? 'Could not remove that person.')
    feedback.success({ title: 'Member removed', description: `${member.name} no longer has access.` })
    await Promise.all([refreshMembers(), refreshWorkspace()])
  } catch (failure) {
    feedback.error({ title: 'Could not remove', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    busyId.value = ''
  }
}

function memberActions(member: WorkspaceMemberRecord) {
  const actions = []

  if (permissions.value?.changeRoles && member.role !== 'owner') {
    actions.push(member.role === 'admin'
      ? { label: 'Make member', icon: 'i-lucide-user', onSelect: () => changeRole(member, 'member') }
      : { label: 'Make admin', icon: 'i-lucide-shield', onSelect: () => changeRole(member, 'admin') })
  }

  if (permissions.value?.removeMembers && member.role !== 'owner' && !member.isYou) {
    actions.push({
      label: 'Remove from workspace',
      icon: 'i-lucide-user-minus',
      color: 'error' as const,
      onSelect: () => removeMember(member)
    })
  }

  return actions.length ? [actions] : []
}

async function retry() {
  await Promise.all([refreshWorkspace(), refreshMembers()])
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="workspace?.organization.name ?? 'Workspace'"
      description="Everyone here can host team meetings. Personal booking pages stay private."
    >
      <template #actions>
        <UButton
          v-if="permissions?.updateWorkspace"
          color="neutral"
          variant="outline"
          icon="i-lucide-settings"
          :to="`/w/${slug}/settings`"
        >
          Settings
        </UButton>
        <UButton
          v-if="permissions?.inviteMembers"
          icon="i-lucide-user-plus"
          :disabled="entitlement && !entitlement.canAddMembers"
          @click="inviting = true"
        >
          Invite
        </UButton>
      </template>
    </PageHeader>

    <div
      v-if="entitlement && entitlement.status === 'trialing'"
      class="flex flex-wrap items-center gap-3 rounded-xl border border-default bg-muted/50 px-4 py-3"
    >
      <UIcon
        name="i-lucide-sparkles"
        class="size-4 shrink-0 text-primary"
      />
      <p class="min-w-0 flex-1 text-[13px] text-muted">
        <span class="font-medium text-highlighted">
          {{ entitlement.daysLeftInTrial }} days left in your trial.
        </span>
        After that it is {{ formatUsd(TEAM_PLAN.monthlyCentsPerSeat) }} per member each month —
        currently {{ formatUsd(entitlement.nextInvoiceCents) }} for
        {{ entitlement.seatsUsed }} {{ entitlement.seatsUsed === 1 ? 'member' : 'members' }}.
      </p>
    </div>

    <div
      v-else-if="entitlement && entitlement.readOnly"
      class="flex flex-wrap items-center gap-3 rounded-xl border border-error/30 bg-error/5 px-4 py-3"
      role="alert"
    >
      <UIcon
        name="i-lucide-circle-alert"
        class="size-4 shrink-0 text-error"
      />
      <p class="min-w-0 flex-1 text-[13px] text-muted">
        <span class="font-medium text-highlighted">This workspace is read-only.</span>
        Team booking pages are not taking new bookings. Everything is still here and exportable.
      </p>
    </div>

    <section
      v-if="permissions?.inviteMembers && pendingInvites.length"
      class="overflow-hidden rounded-xl border border-default bg-default"
    >
      <header class="flex items-center justify-between gap-3 border-b border-default px-4 py-3 sm:px-5">
        <h2 class="text-[13px] font-semibold text-highlighted">
          Pending invitations
        </h2>
        <span class="tnum rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-dimmed">
          {{ pendingInvites.length }}
        </span>
      </header>
      <ul class="divide-y divide-default">
        <li
          v-for="invite in pendingInvites"
          :key="invite.id"
          class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
        >
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-dimmed">
            <UIcon
              name="i-lucide-mail"
              class="size-4"
            />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] font-medium text-highlighted">
              {{ invite.email }}
            </p>
            <p class="mt-0.5 text-[11px] text-muted">
              Invited as {{ invite.role }} by {{ invite.inviterName }}
              <span v-if="invite.expired"> · expired</span>
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="busyId === invite.id"
            @click="revokeInvite(invite.id, invite.email)"
          >
            Revoke
          </UButton>
        </li>
      </ul>
    </section>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="flex flex-col gap-3 border-b border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <ListFilter
          v-model="filter"
          :options="filterOptions"
          :disabled="refreshing"
        />
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search people"
          size="sm"
          class="sm:w-56"
        />
      </div>

      <AsyncErrorState
        v-if="blockingFailure"
        title="Could not load this workspace"
        description="It may have been archived, or your access may have changed."
        :retrying="refreshing"
        @retry="retry"
      />

      <ListLoadingSkeleton
        v-else-if="initialLoading"
        label="Loading members"
      />

      <ListEmptyState
        v-else-if="!list.length"
        icon="i-lucide-users"
        :title="query ? 'No matching people' : 'Nobody here yet'"
        :description="query
          ? 'Try another search or change the filter.'
          : 'Invite your teammates and they will show up here once they accept.'"
      >
        <template
          v-if="permissions?.inviteMembers && !query"
          #action
        >
          <UButton
            icon="i-lucide-user-plus"
            @click="inviting = true"
          >
            Invite someone
          </UButton>
        </template>
      </ListEmptyState>

      <ul
        v-else
        class="divide-y divide-default"
        :class="refreshing && 'opacity-60'"
      >
        <li
          v-for="member in list"
          :key="member.id"
          class="flex items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5"
        >
          <span class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-[12px] font-semibold text-primary">
            <img
              v-if="member.avatarUrl"
              :src="member.avatarUrl"
              alt=""
              class="size-full object-cover"
            >
            <template v-else>
              {{ initials(member.name) }}
            </template>
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-[14px] font-medium text-highlighted">
                {{ member.name }}
              </p>
              <UBadge
                :color="roleColor[member.role]"
                variant="subtle"
                size="sm"
              >
                {{ member.role }}
              </UBadge>
              <span
                v-if="member.isYou"
                class="text-[11px] text-dimmed"
              >You</span>
            </div>
            <p class="mt-0.5 truncate text-[12px] text-muted">
              {{ member.email }}
            </p>
          </div>

          <UDropdownMenu
            v-if="memberActions(member).length"
            :items="memberActions(member)"
            :ui="{ content: 'w-52', item: 'gap-2 px-2.5 py-2 text-[13px]' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-ellipsis"
              class="size-7 justify-center p-0"
              :loading="busyId === member.id"
              :aria-label="`Actions for ${member.name}`"
            />
          </UDropdownMenu>
        </li>
      </ul>

      <ListPagination
        :page="members?.pagination.page ?? 1"
        :total-pages="members?.pagination.totalPages ?? 1"
        :total="members?.pagination.total ?? 0"
        :disabled="refreshing"
        @change="page = $event"
      />
    </section>

    <UModal
      v-model:open="inviting"
      title="Invite to this workspace"
      :description="`They keep their own booking page — joining only adds team scheduling.`"
      :ui="{ content: 'w-full max-w-md', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <form
          id="invite-form"
          class="space-y-4 px-1 py-1"
          @submit.prevent="sendInvite"
        >
          <UFormField
            label="Email address"
            name="email"
            required
          >
            <UInput
              v-model="inviteEmail"
              type="email"
              placeholder="teammate@company.com"
              size="lg"
              autofocus
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Role"
            name="role"
          >
            <USelectMenu
              v-model="inviteRole"
              :items="roleOptions"
              value-key="value"
              size="lg"
              class="w-full"
            />
            <p class="mt-1.5 text-[12px] text-muted">
              Admins can invite people and manage team event types. Ownership can only be transferred, never invited.
            </p>
          </UFormField>

          <p
            v-if="inviteError"
            class="text-[13px] text-error"
            role="alert"
          >
            {{ inviteError }}
          </p>
        </form>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="sending"
            @click="inviting = false"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            form="invite-form"
            :loading="sending"
            :disabled="!inviteEmail.trim()"
          >
            Send invitation
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
