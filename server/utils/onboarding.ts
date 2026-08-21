import { eq } from 'drizzle-orm'
import { availabilityRules, eventTypes, schedules } from '../database/schema'
import { useDatabase } from './database'

const WEEKDAYS = [1, 2, 3, 4, 5]

export async function createStarterSetup(userId: string, timeZone: string) {
  const db = useDatabase()

  await db.transaction(async (tx) => {
    const [schedule] = await tx
      .insert(schedules)
      .values({ userId, name: 'Working hours', timeZone, isDefault: true })
      .returning({ id: schedules.id })

    if (!schedule) throw new Error('failed to create the default schedule')

    await tx.insert(availabilityRules).values(
      WEEKDAYS.map(weekday => ({
        scheduleId: schedule.id,
        weekday,
        startTime: '09:00:00',
        endTime: '17:00:00'
      }))
    )

    await tx.insert(eventTypes).values({
      userId,
      scheduleId: schedule.id,
      slug: '30min',
      title: '30 Minute Meeting',
      description: 'A half hour to talk through whatever you need.',
      durationMinutes: 30,
      minimumNoticeMinutes: 120,
      bookingWindowDays: 60
    })
  })
}

/**
 * Accounts created before starter setup existed have no hours and nothing to
 * book, so their link resolves to an empty page. Repairs that on next use.
 */
export async function ensureStarterSetup(userId: string, timeZone: string) {
  const [existing] = await useDatabase()
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.userId, userId))
    .limit(1)

  if (existing) return false

  await createStarterSetup(userId, timeZone)
  return true
}
