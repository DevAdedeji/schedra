import { and, asc, eq, inArray } from 'drizzle-orm'
import type { TeamEventTypeHostInput } from '#shared/validation'
import { eventTypeHosts, members, schedules } from '../database/schema'
import { useDatabase } from '../database'

type Executor = Pick<ReturnType<typeof useDatabase>, 'select' | 'insert' | 'delete' | 'update'>

/**
 * A host must be a current member of the same team, and any schedule they pin
 * must be one of their own — otherwise a team admin could point a team event at
 * a stranger, or at somebody else's private hours.
 */
export async function resolveHosts(
  organizationId: string,
  hosts: TeamEventTypeHostInput[],
  executor: Executor = useDatabase()
) {
  const memberIds = hosts.map(host => host.memberId)

  const rows = await executor
    .select({ id: members.id, userId: members.userId })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), inArray(members.id, memberIds)))

  if (rows.length !== memberIds.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'One of those hosts is no longer in this team.'
    })
  }

  const userByMember = new Map(rows.map(row => [row.id, row.userId]))

  const pinned = hosts.filter(host => host.scheduleId)
  if (pinned.length) {
    const owned = await executor
      .select({ id: schedules.id, userId: schedules.userId })
      .from(schedules)
      .where(inArray(schedules.id, pinned.map(host => host.scheduleId!)))

    const ownerBySchedule = new Map(owned.map(row => [row.id, row.userId]))

    for (const host of pinned) {
      if (ownerBySchedule.get(host.scheduleId!) !== userByMember.get(host.memberId)) {
        throw createError({
          statusCode: 400,
          statusMessage: 'A host can only use one of their own schedules.'
        })
      }
    }
  }

  return hosts.map(host => ({
    memberId: host.memberId,
    userId: userByMember.get(host.memberId)!,
    scheduleId: host.scheduleId ?? null,
    enabled: host.enabled,
    weight: host.weight
  }))
}

export async function replaceHosts(
  eventTypeId: string,
  organizationId: string,
  hosts: TeamEventTypeHostInput[],
  executor: Executor
) {
  const resolved = await resolveHosts(organizationId, hosts, executor)

  await executor.delete(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, eventTypeId))
  await executor.insert(eventTypeHosts).values(
    resolved.map((host, position) => ({ ...host, eventTypeId, position }))
  )

  return resolved
}

export async function hostsForEventType(eventTypeId: string) {
  return useDatabase()
    .select({
      id: eventTypeHosts.id,
      memberId: eventTypeHosts.memberId,
      userId: eventTypeHosts.userId,
      scheduleId: eventTypeHosts.scheduleId,
      enabled: eventTypeHosts.enabled,
      weight: eventTypeHosts.weight
    })
    .from(eventTypeHosts)
    .where(eq(eventTypeHosts.eventTypeId, eventTypeId))
    .orderBy(asc(eventTypeHosts.position), asc(eventTypeHosts.id))
}
