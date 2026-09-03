import { eq, inArray } from 'drizzle-orm'
import {
  automationWorkflows,
  awayPeriods,
  availabilityRules,
  bookings,
  calendarConnections,
  dateOverrides,
  emailNotificationPreferences,
  eventTypes,
  schedules,
  users,
  videoConferenceConnections
} from '../../database/schema'
import { useDatabase } from '../../database/index'
import { requireAuthSession } from '../../services/session'
import { recordSecurityAudit } from '../../services/security-audit'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const db = useDatabase()
  const [profile, scheduleRows, awayPeriodRows, eventTypeRows, bookingRows, workflowRows, calendarIntegrationRows, videoIntegrationRows, notificationPreferenceRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
    db.select().from(schedules).where(eq(schedules.userId, session.user.id)),
    db.select().from(awayPeriods).where(eq(awayPeriods.userId, session.user.id)),
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
      defaultForBookings: calendarConnections.isDefaultWriteDestination,
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
    }).from(videoConferenceConnections).where(eq(videoConferenceConnections.userId, session.user.id)),
    db.select({
      newBookingEmails: emailNotificationPreferences.newBookingEmails,
      rescheduleEmails: emailNotificationPreferences.rescheduleEmails,
      cancellationEmails: emailNotificationPreferences.cancellationEmails,
      approvalRequestEmails: emailNotificationPreferences.approvalRequestEmails,
      createdAt: emailNotificationPreferences.createdAt,
      updatedAt: emailNotificationPreferences.updatedAt
    }).from(emailNotificationPreferences).where(eq(emailNotificationPreferences.userId, session.user.id)).limit(1)
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
        brandName: profileRow.brandName,
        brandLogoUrl: profileRow.brandLogoUrl,
        brandColor: profileRow.brandColor,
        brandDarkColor: profileRow.brandDarkColor,
        bookingPageTheme: profileRow.bookingPageTheme,
        hideSchedraBranding: profileRow.hideSchedraBranding,
        timeZone: profileRow.timeZone,
        twoFactorEnabled: profileRow.twoFactorEnabled,
        createdAt: profileRow.createdAt,
        updatedAt: profileRow.updatedAt
      }
    : null

  await recordSecurityAudit({
    action: 'account.data_exported',
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    targetType: 'user',
    targetId: session.user.id
  }, event)

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
    awayPeriods: awayPeriodRows,
    eventTypes: eventTypeRows,
    bookings: bookingRows,
    workflows: workflowRows,
    integrations: [...calendarIntegrationRows, ...videoIntegrationRows],
    emailNotificationPreferences: notificationPreferenceRows[0] ?? {
      newBookingEmails: true,
      rescheduleEmails: true,
      cancellationEmails: true,
      approvalRequestEmails: true
    }
  }, null, 2)
})
