import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'
import { createDatabase } from './client'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('team templates and branding persistence', () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} })
  const appDatabase = url ? createDatabase(url, { max: 1 }) : null

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
