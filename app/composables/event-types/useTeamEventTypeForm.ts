import { computed, reactive, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  meetingLocationTypeSchema,
  teamEventTypeSchema,
  type AssignmentMode,
  type TeamEventTypeInput
} from '#shared/validation'
import type { TeamMemberRecord } from '~/services/schedra-api'

function emptyTeamEventTypeForm(): TeamEventTypeInput {
  return {
    title: '', slug: '', description: undefined, durationMinutes: 30, additionalDurationMinutes: [],
    recurringBookingEnabled: false, recurringBookingMaxOccurrences: 8, incrementMinutes: null,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 120,
    bookingWindowDays: 60, maxPerDay: null, locationType: 'custom',
    locationDetails: 'The host will share meeting details before the meeting.',
    reminderMinutes: [1440, 60], bookingQuestions: [], requiresConfirmation: false,
    capacity: 1, paymentEnabled: false, priceCents: null, paymentCurrency: 'USD',
    hidden: false, assignmentMode: 'round_robin', hosts: []
  }
}

export function useTeamEventTypeForm(options: {
  members: MaybeRefOrGetter<TeamMemberRecord[]>
  teamKey: MaybeRefOrGetter<string>
}) {
  const form = reactive<TeamEventTypeInput>(emptyTeamEventTypeForm())
  const slugTouched = ref(false)
  const knownMembers = shallowRef(new Map<string, TeamMemberRecord>())

  const groupEventEnabled = computed({
    get: () => form.capacity > 1,
    set: (enabled) => {
      form.capacity = enabled ? 10 : 1
      if (enabled) form.recurringBookingEnabled = false
    }
  })
  const paidBookingEnabled = computed({
    get: () => form.paymentEnabled,
    set: (enabled: boolean) => {
      form.paymentEnabled = enabled
      form.priceCents = enabled ? (form.priceCents ?? 2500) : null
      if (enabled) {
        form.requiresConfirmation = false
        form.recurringBookingEnabled = false
      }
    }
  })
  const priceAmount = computed({
    get: () => form.priceCents === null ? undefined : form.priceCents / 100,
    set: (value: number | undefined) => { form.priceCents = value === undefined ? null : Math.round(value * 100) }
  })

  const assignmentOptions = [
    { value: 'single' as const, label: 'One host', icon: 'i-lucide-user', hint: 'The same person takes every booking.' },
    { value: 'round_robin' as const, label: 'Round robin', icon: 'i-lucide-shuffle', hint: 'Whoever is free and least recently booked gets it.' },
    { value: 'collective' as const, label: 'Everyone', icon: 'i-lucide-users', hint: 'Only offered when every host is free, and all of them attend.' }
  ]

  watch(() => toValue(options.members), (members) => {
    const next = new Map(knownMembers.value)
    for (const member of members) next.set(member.id, member)
    knownMembers.value = next
  }, { immediate: true })
  watch(() => toValue(options.teamKey), () => {
    knownMembers.value = new Map()
  })

  const selectedMembers = computed(() => form.hosts
    .filter(host => host.enabled)
    .map(host => knownMembers.value.get(host.memberId))
    .filter((member): member is TeamMemberRecord => Boolean(member)))
  const meetingOwners = computed(() => form.assignmentMode === 'collective'
    ? selectedMembers.value.slice(0, 1)
    : selectedMembers.value)
  const googleMeetReady = computed(() => selectedMembers.value.length > 0
    && selectedMembers.value.every(member => member.integrations.googleMeet))
  const microsoftTeamsReady = computed(() => selectedMembers.value.length > 0
    && selectedMembers.value.every(member => member.integrations.microsoftTeams))
  const zoomReady = computed(() => meetingOwners.value.length > 0
    && meetingOwners.value.every(member => member.integrations.zoom))

  const locationOptions = computed(() => meetingLocationTypeSchema.options.map(value => ({
    label: {
      google_meet: 'Google Meet', microsoft_teams: 'Microsoft Teams', zoom: 'Zoom',
      video_link: 'Video link', phone: 'Phone call', in_person: 'In person', custom: 'Custom instructions'
    }[value],
    value,
    disabled: value === 'google_meet'
      ? !googleMeetReady.value
      : value === 'microsoft_teams'
        ? !microsoftTeamsReady.value
        : value === 'zoom' ? !zoomReady.value : false
  })))

  const selectedIds = computed(() => new Set(form.hosts.map(host => host.memberId)))
  const valid = computed(() => teamEventTypeSchema.safeParse(form).success)
  const validationMessage = computed(() => {
    const result = teamEventTypeSchema.safeParse(form)
    return result.success ? '' : result.error.issues[0]?.message ?? ''
  })

  function resetForm(value?: Partial<TeamEventTypeInput> | null) {
    Object.assign(form, {
      ...emptyTeamEventTypeForm(),
      ...value,
      additionalDurationMinutes: value?.additionalDurationMinutes ?? [],
      hosts: value?.hosts ?? []
    })
  }

  function toggleHost(member: TeamMemberRecord) {
    if (selectedIds.value.has(member.id)) {
      form.hosts = form.hosts.filter(host => host.memberId !== member.id)
      return
    }
    const entry = { memberId: member.id, scheduleId: null, enabled: true, weight: 100 }
    form.hosts = form.assignmentMode === 'single' ? [entry] : [...form.hosts, entry]
  }

  watch(() => form.title, (value) => {
    if (slugTouched.value) return
    form.slug = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  })
  watch(() => form.assignmentMode, (mode: AssignmentMode) => {
    if (mode !== 'single') return
    const first = form.hosts.find(host => host.enabled) ?? form.hosts[0]
    form.hosts = first ? [{ ...first, enabled: true }] : []
  })
  watch(() => form.requiresConfirmation, (required) => {
    if (required) form.recurringBookingEnabled = false
  })

  return {
    form, slugTouched, groupEventEnabled, paidBookingEnabled, priceAmount,
    assignmentOptions, selectedMembers, meetingOwners, googleMeetReady,
    microsoftTeamsReady, zoomReady, locationOptions, selectedIds, valid,
    validationMessage, resetForm, toggleHost
  }
}
