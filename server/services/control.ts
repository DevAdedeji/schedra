import { count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { paginationMeta } from '#shared/pagination'
import {
  accounts,
  bookings,
  calendarConnections,
  eventTypeHosts,
  eventTypes,
  members,
  organizationSubscriptions,
  organizations,
  personalSubscriptions,
  users,
  videoConferenceConnections
} from '../database/schema'
import { useDatabase } from '../database'

interface ControlListInput {
  page: number
  pageSize: number
  search: string
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}

export async function controlOverview() {
  const db = useDatabase()
  const [userTotals, organizationTotals, eventTypeTotals, bookingTotals, subscriptionTotals, recentUsers] = await Promise.all([
    db.select({
      total: count(),
      verified: sql<number>`count(*) filter (where ${users.emailVerified} is true)`.mapWith(Number),
      twoFactor: sql<number>`count(*) filter (where ${users.twoFactorEnabled} is true)`.mapWith(Number),
      joinedLastThirtyDays: sql<number>`count(*) filter (where ${users.createdAt} >= now() - interval '30 days')`.mapWith(Number)
    }).from(users),
    db.select({
      total: count(),
      active: sql<number>`count(*) filter (where ${organizations.archivedAt} is null)`.mapWith(Number)
    }).from(organizations),
    db.select({
      total: count(),
      visible: sql<number>`count(*) filter (where ${eventTypes.hidden} is false)`.mapWith(Number)
    }).from(eventTypes),
    db.select({
      total: count(),
      upcoming: sql<number>`count(*) filter (where ${bookings.startsAt} >= now() and ${bookings.status} in ('pending', 'confirmed'))`.mapWith(Number),
      createdLastThirtyDays: sql<number>`count(*) filter (where ${bookings.createdAt} >= now() - interval '30 days')`.mapWith(Number)
    }).from(bookings),
    Promise.all([
      db.select({ value: count() }).from(personalSubscriptions)
        .where(inArray(personalSubscriptions.status, ['trialing', 'active'])),
      db.select({ value: count() }).from(organizationSubscriptions)
        .where(inArray(organizationSubscriptions.status, ['trialing', 'active']))
    ]),
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt
    }).from(users).orderBy(desc(users.createdAt)).limit(5)
  ])

  return {
    users: userTotals[0] ?? { total: 0, verified: 0, twoFactor: 0, joinedLastThirtyDays: 0 },
    organizations: organizationTotals[0] ?? { total: 0, active: 0 },
    eventTypes: eventTypeTotals[0] ?? { total: 0, visible: 0 },
    bookings: bookingTotals[0] ?? { total: 0, upcoming: 0, createdLastThirtyDays: 0 },
    subscriptions: {
      personal: subscriptionTotals[0][0]?.value ?? 0,
      teams: subscriptionTotals[1][0]?.value ?? 0
    },
    recentUsers: recentUsers.map(user => ({ ...user, createdAt: user.createdAt.toISOString() }))
  }
}

export async function controlUsers(input: ControlListInput) {
  const db = useDatabase()
  const where = input.search
    ? or(
        ilike(users.name, `%${input.search}%`),
        ilike(users.email, `%${input.search}%`),
        ilike(users.username, `%${input.search}%`)
      )
    : undefined
  const offset = (input.page - 1) * input.pageSize

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(users).where(where),
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      emailVerified: users.emailVerified,
      twoFactorEnabled: users.twoFactorEnabled,
      timeZone: users.timeZone,
      createdAt: users.createdAt,
      subscriptionStatus: personalSubscriptions.status,
      eventTypeCount: sql<number>`(select count(*)::int from ${eventTypes} where ${eventTypes.userId} = ${users.id})`.mapWith(Number),
      bookingCount: sql<number>`(select count(*)::int from ${bookings} where ${bookings.hostId} = ${users.id})`.mapWith(Number),
      teamCount: sql<number>`(select count(*)::int from ${members} where ${members.userId} = ${users.id})`.mapWith(Number)
    }).from(users)
      .leftJoin(personalSubscriptions, eq(personalSubscriptions.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(input.pageSize)
      .offset(offset)
  ])

  const userIds = rows.map(row => row.id)
  const providerRows = userIds.length
    ? await db.select({ userId: accounts.userId, providerId: accounts.providerId })
        .from(accounts)
        .where(inArray(accounts.userId, userIds))
    : []
  const providersByUser = new Map<string, Set<string>>()
  for (const provider of providerRows) {
    const current = providersByUser.get(provider.userId) ?? new Set<string>()
    current.add(provider.providerId)
    providersByUser.set(provider.userId, current)
  }

  return {
    items: rows.map(row => ({
      ...row,
      subscriptionStatus: row.subscriptionStatus ?? 'free',
      providers: [...(providersByUser.get(row.id) ?? [])].sort(),
      createdAt: row.createdAt.toISOString()
    })),
    pagination: paginationMeta(total?.value ?? 0, input.page, input.pageSize)
  }
}

export async function controlUserDetail(userId: string) {
  const db = useDatabase()
  const [profileRows, providerRows, calendarRows, videoRows, teamRows, personalEventRows, hostedEventRows, recentBookingRows] = await Promise.all([
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
      timeZone: users.timeZone,
      emailVerified: users.emailVerified,
      twoFactorEnabled: users.twoFactorEnabled,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      subscriptionStatus: personalSubscriptions.status,
      subscriptionInterval: personalSubscriptions.interval,
      currentPeriodEnd: personalSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: personalSubscriptions.cancelAtPeriodEnd
    }).from(users)
      .leftJoin(personalSubscriptions, eq(personalSubscriptions.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1),
    db.select({ provider: accounts.providerId }).from(accounts).where(eq(accounts.userId, userId)),
    db.select({
      provider: calendarConnections.provider,
      accountLabel: calendarConnections.accountLabel,
      status: calendarConnections.status,
      lastCheckedAt: calendarConnections.lastCheckedAt
    }).from(calendarConnections).where(eq(calendarConnections.userId, userId)),
    db.select({
      provider: videoConferenceConnections.provider,
      accountLabel: videoConferenceConnections.accountLabel,
      status: videoConferenceConnections.status,
      lastCheckedAt: videoConferenceConnections.lastCheckedAt
    }).from(videoConferenceConnections).where(eq(videoConferenceConnections.userId, userId)),
    db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: members.role,
      archivedAt: organizations.archivedAt,
      joinedAt: members.createdAt,
      subscriptionStatus: organizationSubscriptions.status
    }).from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .leftJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id))
      .where(eq(members.userId, userId))
      .orderBy(desc(members.createdAt)),
    db.select({
      id: eventTypes.id,
      title: eventTypes.title,
      slug: eventTypes.slug,
      durationMinutes: eventTypes.durationMinutes,
      hidden: eventTypes.hidden,
      createdAt: eventTypes.createdAt,
      organizationId: eventTypes.organizationId,
      organizationName: organizations.name,
      bookingCount: sql<number>`(select count(*)::int from ${bookings} where ${bookings.eventTypeId} = ${eventTypes.id})`.mapWith(Number)
    }).from(eventTypes)
      .leftJoin(organizations, eq(organizations.id, eventTypes.organizationId))
      .where(eq(eventTypes.userId, userId))
      .orderBy(desc(eventTypes.createdAt)),
    db.selectDistinct({
      id: eventTypes.id,
      title: eventTypes.title,
      slug: eventTypes.slug,
      durationMinutes: eventTypes.durationMinutes,
      hidden: eventTypes.hidden,
      createdAt: eventTypes.createdAt,
      organizationId: eventTypes.organizationId,
      organizationName: organizations.name,
      bookingCount: sql<number>`(select count(*)::int from ${bookings} where ${bookings.eventTypeId} = ${eventTypes.id})`.mapWith(Number)
    }).from(eventTypeHosts)
      .innerJoin(eventTypes, eq(eventTypes.id, eventTypeHosts.eventTypeId))
      .innerJoin(organizations, eq(organizations.id, eventTypes.organizationId))
      .where(eq(eventTypeHosts.userId, userId))
      .orderBy(desc(eventTypes.createdAt)),
    db.select({
      uid: bookings.uid,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      createdAt: bookings.createdAt,
      eventTypeTitle: eventTypes.title,
      organizationName: organizations.name
    }).from(bookings)
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .leftJoin(organizations, eq(organizations.id, bookings.organizationId))
      .where(eq(bookings.hostId, userId))
      .orderBy(desc(bookings.createdAt))
      .limit(10)
  ])

  const profile = profileRows[0]
  if (!profile) return null

  const serializeEventType = (eventType: typeof personalEventRows[number] | typeof hostedEventRows[number]) => ({
    ...eventType,
    scope: eventType.organizationId ? 'team' as const : 'personal' as const,
    createdAt: eventType.createdAt.toISOString()
  })

  return {
    user: {
      ...profile,
      subscriptionStatus: profile.subscriptionStatus ?? 'free',
      subscriptionInterval: profile.subscriptionInterval ?? null,
      currentPeriodEnd: iso(profile.currentPeriodEnd),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString()
    },
    authProviders: [...new Set(providerRows.map(row => row.provider))].sort(),
    integrations: [
      ...calendarRows.map(row => ({ ...row, kind: 'calendar' as const, lastCheckedAt: iso(row.lastCheckedAt) })),
      ...videoRows.map(row => ({ ...row, kind: 'video' as const, lastCheckedAt: iso(row.lastCheckedAt) }))
    ],
    teams: teamRows.map(team => ({
      ...team,
      subscriptionStatus: team.subscriptionStatus ?? 'none',
      archivedAt: iso(team.archivedAt),
      joinedAt: team.joinedAt.toISOString()
    })),
    eventTypes: [
      ...personalEventRows.map(serializeEventType),
      ...hostedEventRows.map(serializeEventType)
    ],
    recentBookings: recentBookingRows.map(booking => ({
      ...booking,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      createdAt: booking.createdAt.toISOString()
    })),
    counts: {
      teams: teamRows.length,
      eventTypes: personalEventRows.length + hostedEventRows.length,
      bookings: await db.select({ value: count() }).from(bookings).where(eq(bookings.hostId, userId)).then(rows => rows[0]?.value ?? 0),
      integrations: calendarRows.length + videoRows.length
    }
  }
}

export async function controlEventTypes(input: ControlListInput) {
  const db = useDatabase()
  const where = input.search
    ? or(
        ilike(eventTypes.title, `%${input.search}%`),
        ilike(eventTypes.slug, `%${input.search}%`),
        ilike(users.name, `%${input.search}%`),
        ilike(users.email, `%${input.search}%`),
        ilike(organizations.name, `%${input.search}%`)
      )
    : undefined
  const offset = (input.page - 1) * input.pageSize
  const base = db.select({ value: count() }).from(eventTypes)
    .leftJoin(users, eq(users.id, eventTypes.userId))
    .leftJoin(organizations, eq(organizations.id, eventTypes.organizationId))

  const [[total], rows] = await Promise.all([
    base.where(where),
    db.select({
      id: eventTypes.id,
      title: eventTypes.title,
      slug: eventTypes.slug,
      durationMinutes: eventTypes.durationMinutes,
      additionalDurationMinutes: eventTypes.additionalDurationMinutes,
      hidden: eventTypes.hidden,
      capacity: eventTypes.capacity,
      paymentEnabled: eventTypes.paymentEnabled,
      createdAt: eventTypes.createdAt,
      userId: users.id,
      ownerName: users.name,
      ownerEmail: users.email,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      bookingCount: sql<number>`(select count(*)::int from ${bookings} where ${bookings.eventTypeId} = ${eventTypes.id})`.mapWith(Number)
    }).from(eventTypes)
      .leftJoin(users, eq(users.id, eventTypes.userId))
      .leftJoin(organizations, eq(organizations.id, eventTypes.organizationId))
      .where(where)
      .orderBy(desc(eventTypes.createdAt))
      .limit(input.pageSize)
      .offset(offset)
  ])

  return {
    items: rows.map(row => ({ ...row, scope: row.organizationId ? 'team' as const : 'personal' as const, createdAt: row.createdAt.toISOString() })),
    pagination: paginationMeta(total?.value ?? 0, input.page, input.pageSize)
  }
}

export async function controlOrganizations(input: ControlListInput) {
  const db = useDatabase()
  const where = input.search
    ? or(ilike(organizations.name, `%${input.search}%`), ilike(organizations.slug, `%${input.search}%`))
    : undefined
  const offset = (input.page - 1) * input.pageSize

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(organizations).where(where),
    db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      archivedAt: organizations.archivedAt,
      createdAt: organizations.createdAt,
      subscriptionStatus: organizationSubscriptions.status,
      subscriptionInterval: organizationSubscriptions.interval,
      memberCount: sql<number>`(select count(*)::int from ${members} where ${members.organizationId} = ${organizations.id})`.mapWith(Number),
      eventTypeCount: sql<number>`(select count(*)::int from ${eventTypes} where ${eventTypes.organizationId} = ${organizations.id})`.mapWith(Number),
      bookingCount: sql<number>`(select count(*)::int from ${bookings} where ${bookings.organizationId} = ${organizations.id})`.mapWith(Number),
      ownerName: sql<string | null>`(select ${users.name} from ${members} owner_member inner join ${users} on ${users.id} = owner_member.user_id where owner_member.organization_id = ${organizations.id} and owner_member.role = 'owner' limit 1)`,
      ownerEmail: sql<string | null>`(select ${users.email} from ${members} owner_member inner join ${users} on ${users.id} = owner_member.user_id where owner_member.organization_id = ${organizations.id} and owner_member.role = 'owner' limit 1)`
    }).from(organizations)
      .leftJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id))
      .where(where)
      .orderBy(desc(organizations.createdAt))
      .limit(input.pageSize)
      .offset(offset)
  ])

  return {
    items: rows.map(row => ({
      ...row,
      subscriptionStatus: row.subscriptionStatus ?? 'none',
      subscriptionInterval: row.subscriptionInterval ?? null,
      archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString()
    })),
    pagination: paginationMeta(total?.value ?? 0, input.page, input.pageSize)
  }
}

export async function controlBookings(input: ControlListInput) {
  const db = useDatabase()
  const where = input.search
    ? or(
        ilike(bookings.uid, `%${input.search}%`),
        ilike(eventTypes.title, `%${input.search}%`),
        ilike(users.name, `%${input.search}%`),
        ilike(users.email, `%${input.search}%`),
        ilike(organizations.name, `%${input.search}%`)
      )
    : undefined
  const offset = (input.page - 1) * input.pageSize
  const joins = db.select({ value: count() }).from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .leftJoin(organizations, eq(organizations.id, bookings.organizationId))

  const [[total], rows] = await Promise.all([
    joins.where(where),
    db.select({
      uid: bookings.uid,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      createdAt: bookings.createdAt,
      source: bookings.source,
      eventTypeTitle: eventTypes.title,
      hostId: users.id,
      hostName: users.name,
      hostEmail: users.email,
      organizationName: organizations.name
    }).from(bookings)
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .innerJoin(users, eq(users.id, bookings.hostId))
      .leftJoin(organizations, eq(organizations.id, bookings.organizationId))
      .where(where)
      .orderBy(desc(bookings.createdAt))
      .limit(input.pageSize)
      .offset(offset)
  ])

  return {
    items: rows.map(row => ({
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString()
    })),
    pagination: paginationMeta(total?.value ?? 0, input.page, input.pageSize)
  }
}
