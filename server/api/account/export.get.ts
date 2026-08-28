import { eq, inArray } from 'drizzle-orm'
import {
  automationWorkflows,
  availabilityRules,
  bookings,
  calendarConnections,
  dateOverrides,
  eventTypes,
  schedules,
  users,
  videoConferenceConnections
} from '../../database/schema'
import { useDatabase } from '../../database/index'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const db = useDatabase()
  const [profile, scheduleRows, eventTypeRows, bookingRows, workflowRows, calendarIntegrationRows, videoIntegrationRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
    db.select().from(schedules).where(eq(schedules.userId, session.user.id)),
    db.select().from(eventTypes).where(eq(eventTypes.userId, session.user.id)),
    db.select().from(bookings).where(eq(bookings.hostId, session.user.id)),
    db.select({
      name: automationWorkflows.name,
      trigger: automationWorkflows.trigger,
      offsetMinutes: automationWorkflows.offsetMinutes,
      eventTypeId: automationWorkflows.eventTypeId,
      action: automationWorkflows.action,
      active: automationWorkflows.active,
      createdAt: automationWorkflows.createdAt,
      updatedAt: automationWorkflows.updatedAt
    }).from(automationWorkflows).where(eq(automationWorkflows.userId, session.user.id)),
    db.select({
      provider: calendarConnections.provider,
      accountLabel: calendarConnections.accountLabel,
      conflictCalendarIds: calendarConnections.conflictCalendarIds,
      writeCalendarId: calendarConnections.writeCalendarId,
      status: calendarConnections.status,
      createdAt: calendarConnections.createdAt,
      updatedAt: calendarConnections.updatedAt
    }).from(calendarConnections).where(eq(calendarConnections.userId, session.user.id)),
    db.select({
      provider: videoConferenceConnections.provider,
      accountLabel: videoConferenceConnections.accountLabel,
      status: videoConferenceConnections.status,
      createdAt: videoConferenceConnections.createdAt,
      updatedAt: videoConferenceConnections.updatedAt
    }).from(videoConferenceConnections).where(eq(videoConferenceConnections.userId, session.user.id))
  ])
  const scheduleIds = scheduleRows.map(schedule => schedule.id)
  const rules = scheduleIds.length ? await db.select().from(availabilityRules).where(inArray(availabilityRules.scheduleId, scheduleIds)) : []
  const overrides = scheduleIds.length ? await db.select().from(dateOverrides).where(inArray(dateOverrides.scheduleId, scheduleIds)) : []
  const profileRow = profile[0]
  const safeProfile = profileRow
    ? {
        email: profileRow.email,
        emailVerified: profileRow.emailVerified,
        name: profileRow.name,
        username: profileRow.username,
        bio: profileRow.bio,
        avatarUrl: profileRow.avatarUrl,
        timeZone: profileRow.timeZone,
        createdAt: profileRow.createdAt,
        updatedAt: profileRow.updatedAt
      }
    : null

  setResponseHeaders(event, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="schedra-export-${new Date().toISOString().slice(0, 10)}.json"`,
    'cache-control': 'private, no-store'
  })
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    profile: safeProfile,
    schedules: scheduleRows.map(schedule => ({
      ...schedule,
      rules: rules.filter(rule => rule.scheduleId === schedule.id),
      overrides: overrides.filter(override => override.scheduleId === schedule.id)
    })),
    eventTypes: eventTypeRows,
    bookings: bookingRows,
    workflows: workflowRows,
    integrations: [...calendarIntegrationRows, ...videoIntegrationRows]
  }, null, 2)
})
