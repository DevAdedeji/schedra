import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'
import { createDatabase } from './client'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('team templates and branding persistence', () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} })
  const appDatabase = url ? createDatabase(url, { max: 2 }) : null

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input))
    await sql`truncate table organizations, users restart identity cascade`
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await appDatabase?.client.end()
    await sql.end()
  })

  async function fixture() {
    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, username, time_zone)
      values ('owner@example.com', 'Owner', 'owner', 'UTC') returning id
    `
    const [team] = await sql<{ id: string }[]>`
      insert into organizations (name, slug) values ('Acme', 'acme') returning id
    `
    const [other] = await sql<{ id: string }[]>`
      insert into organizations (name, slug) values ('Other', 'other') returning id
    `
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (
        organization_id, created_by_user_id, user_id, slug, title, description,
        duration_minutes, additional_duration_minutes, location_type, location_details,
        reminder_minutes, assignment_mode, hidden
      ) values (
        ${team!.id}, ${user!.id}, null, 'discovery', 'Discovery call', 'Meet the team',
        30, array[60], 'custom', 'Details follow after booking.',
        '[1440,60]'::jsonb, 'round_robin', false
      ) returning id
    `
    return { user: user!, team: team!, other: other!, eventType: eventType! }
  }

  it('copies a validated snapshot only from the same team', async () => {
    const { team, other, eventType } = await fixture()
    const { snapshotTeamEventDefaults } = await import('../services/team-event-template')

    const snapshot = await snapshotTeamEventDefaults(team.id, eventType.id, appDatabase!.db)
    expect(snapshot).toMatchObject({ title: 'Discovery call', durationMinutes: 30, additionalDurationMinutes: [60] })
    await expect(snapshotTeamEventDefaults(other.id, eventType.id, appDatabase!.db)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('keeps templates as snapshots when their source changes or is deleted', async () => {
    const { team, user, eventType } = await fixture()
    const { snapshotTeamEventDefaults } = await import('../services/team-event-template')
    const snapshot = await snapshotTeamEventDefaults(team.id, eventType.id, appDatabase!.db)
    const [template] = await sql<{ id: string }[]>`
      insert into organization_event_templates (
        organization_id, name, defaults, source_event_type_id, created_by_user_id
      ) values (${team.id}, 'Standard call', ${sql.json(snapshot)}, ${eventType.id}, ${user.id}) returning id
    `

    await sql`update event_types set duration_minutes = 45 where id = ${eventType.id}`
    const [unchanged] = await sql<{ defaults: { durationMinutes: number } }[]>`
      select defaults from organization_event_templates where id = ${template!.id}
    `
    expect(unchanged!.defaults.durationMinutes).toBe(30)

    await sql`delete from event_types where id = ${eventType.id}`
    const [preserved] = await sql<{ sourceEventTypeId: string | null }[]>`
      select source_event_type_id as "sourceEventTypeId" from organization_event_templates where id = ${template!.id}
    `
    expect(preserved?.sourceEventTypeId).toBeNull()
  })

  it('enforces active template names and organization cascades', async () => {
    const { team, user, eventType } = await fixture()
    const { snapshotTeamEventDefaults } = await import('../services/team-event-template')
    const snapshot = await snapshotTeamEventDefaults(team.id, eventType.id, appDatabase!.db)
    await sql`
      insert into organization_event_templates (organization_id, name, defaults, source_event_type_id, created_by_user_id)
      values (${team.id}, 'Standard call', ${sql.json(snapshot)}, ${eventType.id}, ${user.id})
    `
    await expect(sql`
      insert into organization_event_templates (organization_id, name, defaults, source_event_type_id, created_by_user_id)
      values (${team.id}, 'standard CALL', ${sql.json(snapshot)}, ${eventType.id}, ${user.id})
    `).rejects.toThrow()

    await sql`update organization_event_templates set archived_at = now() where organization_id = ${team.id}`
    await expect(sql`
      insert into organization_event_templates (organization_id, name, defaults, source_event_type_id, created_by_user_id)
      values (${team.id}, 'Standard call', ${sql.json(snapshot)}, ${eventType.id}, ${user.id})
    `).resolves.toBeDefined()

    await sql`delete from event_types where organization_id = ${team.id}`
    await sql`delete from organizations where id = ${team.id}`
    const [count] = await sql<{ value: number }[]>`select count(*)::int as value from organization_event_templates`
    expect(count?.value).toBe(0)
  })

  it('serializes concurrent creates at the active template limit', async () => {
    const { team, user, eventType } = await fixture()
    const {
      createTeamEventTemplate,
      MAX_ACTIVE_TEAM_EVENT_TEMPLATES,
      snapshotTeamEventDefaults
    } = await import('../services/team-event-template')
    const defaults = await snapshotTeamEventDefaults(team.id, eventType.id, appDatabase!.db)
    await sql`
      insert into organization_event_templates (
        organization_id, name, defaults, source_event_type_id, created_by_user_id
      )
      select
        ${team.id},
        'Template ' || value,
        ${sql.json(defaults)},
        ${eventType.id},
        ${user.id}
      from generate_series(1, ${MAX_ACTIVE_TEAM_EVENT_TEMPLATES - 1}) as value
    `

    const blocker = await sql.reserve()
    let transactionOpen = false
    try {
      await blocker`begin`
      transactionOpen = true
      await blocker`select pg_advisory_xact_lock(hashtextextended(${team.id}, 0))`

      let settled = 0
      const outcomesPromise = Promise.allSettled(['Final A', 'Final B'].map(name => createTeamEventTemplate({
        organizationId: team.id,
        name,
        defaults,
        sourceEventTypeId: eventType.id,
        createdByUserId: user.id
      }, appDatabase!.db).finally(() => { settled += 1 })))

      await new Promise(resolve => setTimeout(resolve, 30))
      expect(settled).toBe(0)
      await blocker`commit`
      transactionOpen = false

      const outcomes = await outcomesPromise
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = outcomes.find(result => result.status === 'rejected')
      expect(rejected).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } })
    } finally {
      if (transactionOpen) await blocker`rollback`
      blocker.release()
    }

    const [active] = await sql<{ value: number }[]>`
      select count(*)::int as value
      from organization_event_templates
      where organization_id = ${team.id} and archived_at is null
    `
    expect(active?.value).toBe(MAX_ACTIVE_TEAM_EVENT_TEMPLATES)
  })

  it('creates collision-safe member links and synchronizes only admin-controlled fields', async () => {
    const { team, user, eventType } = await fixture()
    const [memberUser] = await sql<{ id: string }[]>`
      insert into users (email, name, username, time_zone)
      values ('agent@example.com', 'Agent', 'agent', 'UTC') returning id
    `
    const [member] = await sql<{ id: string }[]>`
      insert into members (organization_id, user_id, role)
      values (${team.id}, ${memberUser!.id}, 'member') returning id
    `
    await sql`
      insert into event_types (
        organization_id, created_by_user_id, user_id, slug, title, duration_minutes,
        location_type, location_details, reminder_minutes, assignment_mode, hidden
      ) values (
        ${team.id}, ${user.id}, null, 'discovery-call-agent', 'Existing link', 30,
        'custom', 'Existing details', '[1440]'::jsonb, 'single', false
      )
    `
    const {
      createTeamEventTemplate,
      snapshotTeamEventDefaults,
      updateTeamEventTemplate
    } = await import('../services/team-event-template')
    const defaults = await snapshotTeamEventDefaults(team.id, eventType.id, appDatabase!.db)
    const created = await createTeamEventTemplate({
      organizationId: team.id,
      name: 'Managed discovery',
      defaults,
      sourceEventTypeId: eventType.id,
      createdByUserId: user.id,
      assignmentMemberIds: [member!.id],
      memberEditableFields: ['description']
    }, appDatabase!.db)

    const [managed] = await sql<{
      eventTypeId: string
      slug: string
      title: string
      description: string
      durationMinutes: number
      assignmentMode: string
      hostUserId: string
    }[]>`
      select
        a.event_type_id as "eventTypeId",
        e.slug,
        e.title,
        e.description,
        e.duration_minutes as "durationMinutes",
        e.assignment_mode as "assignmentMode",
        h.user_id as "hostUserId"
      from organization_event_template_assignments a
      join event_types e on e.id = a.event_type_id
      join event_type_hosts h on h.event_type_id = e.id
      where a.template_id = ${created.id}
    `
    expect(managed).toMatchObject({
      slug: 'discovery-call-agent-2',
      title: 'Discovery call',
      description: 'Meet the team',
      durationMinutes: 30,
      assignmentMode: 'single',
      hostUserId: memberUser!.id
    })

    await sql`update event_types set description = 'Agent introduction' where id = ${managed!.eventTypeId}`
    await sql`update event_types set title = 'Qualification call', duration_minutes = 45, description = 'Admin copy' where id = ${eventType.id}`
    const latest = await snapshotTeamEventDefaults(team.id, eventType.id, appDatabase!.db)
    await updateTeamEventTemplate({
      id: created.id,
      organizationId: team.id,
      name: 'Managed qualification',
      defaults: latest,
      sourceEventTypeId: eventType.id,
      createdByUserId: user.id,
      assignmentMemberIds: [member!.id],
      memberEditableFields: ['description']
    }, appDatabase!.db)

    const [synchronized] = await sql<{ title: string, description: string, durationMinutes: number }[]>`
      select title, description, duration_minutes as "durationMinutes"
      from event_types where id = ${managed!.eventTypeId}
    `
    expect(synchronized).toEqual({
      title: 'Qualification call',
      description: 'Agent introduction',
      durationMinutes: 45
    })

    await updateTeamEventTemplate({
      id: created.id,
      organizationId: team.id,
      name: 'Managed qualification',
      defaults: latest,
      sourceEventTypeId: eventType.id,
      createdByUserId: user.id,
      assignmentMemberIds: [],
      memberEditableFields: ['description']
    }, appDatabase!.db)
    const [detached] = await sql<{ assignments: number, eventTypes: number }[]>`
      select
        (select count(*)::int from organization_event_template_assignments where template_id = ${created.id}) as assignments,
        (select count(*)::int from event_types where id = ${managed!.eventTypeId}) as "eventTypes"
    `
    expect(detached).toEqual({ assignments: 0, eventTypes: 1 })
  })

  it('rejects managed assignments to a member from another team', async () => {
    const { team, other, user, eventType } = await fixture()
    const [outsider] = await sql<{ id: string }[]>`
      insert into users (email, name, username, time_zone)
      values ('outsider@example.com', 'Outsider', 'outsider', 'UTC') returning id
    `
    const [otherMember] = await sql<{ id: string }[]>`
      insert into members (organization_id, user_id, role)
      values (${other.id}, ${outsider!.id}, 'member') returning id
    `
    const { createTeamEventTemplate, snapshotTeamEventDefaults } = await import('../services/team-event-template')
    const defaults = await snapshotTeamEventDefaults(team.id, eventType.id, appDatabase!.db)
    await expect(createTeamEventTemplate({
      organizationId: team.id,
      name: 'Unsafe assignment',
      defaults,
      sourceEventTypeId: eventType.id,
      createdByUserId: user.id,
      assignmentMemberIds: [otherMember!.id],
      memberEditableFields: []
    }, appDatabase!.db)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('uses safe branding defaults and validates stored colours', async () => {
    const { team } = await fixture()
    const { storedTeamBranding } = await import('../services/team-branding')
    await expect(storedTeamBranding(team.id)).resolves.toMatchObject({
      brandName: 'Acme',
      brandColor: '#FF3D00',
      brandDarkColor: '#FF6F42',
      bookingPageTheme: 'system'
    })
    await expect(sql`update organizations set brand_color = 'not-css' where id = ${team.id}`).rejects.toThrow()
  })
})
