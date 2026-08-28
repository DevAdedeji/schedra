import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { RoutingFormInput } from '#shared/routing'
import { routeSubmission } from '#shared/routing'
import type { Database } from '../database/client'
import {
  eventTypes,
  organizations,
  routingForms,
  routingResponses,
  routingRules,
  users
} from '../database/schema'
import { useDatabase } from '../database'

export type RoutingOwner
  = | { userId: string, organizationId?: never }
    | { organizationId: string, userId?: never }

function ownerWhere(owner: RoutingOwner) {
  return 'userId' in owner && owner.userId
    ? eq(routingForms.userId, owner.userId)
    : eq(routingForms.organizationId, owner.organizationId!)
}

function eventOwnerWhere(owner: RoutingOwner) {
  return 'userId' in owner && owner.userId
    ? eq(eventTypes.userId, owner.userId)
    : eq(eventTypes.organizationId, owner.organizationId!)
}

export async function routingEventOptions(owner: RoutingOwner) {
  return useDatabase().select({ id: eventTypes.id, title: eventTypes.title, slug: eventTypes.slug })
    .from(eventTypes)
    .where(and(eventOwnerWhere(owner), eq(eventTypes.hidden, false)))
    .orderBy(asc(eventTypes.title))
}

export async function listRoutingForms(owner: RoutingOwner) {
  const forms = await useDatabase().select({
    id: routingForms.id,
    slug: routingForms.slug,
    title: routingForms.title,
    description: routingForms.description,
    active: routingForms.active,
    questions: routingForms.questions,
    defaultEventTitle: eventTypes.title,
    createdAt: routingForms.createdAt
  }).from(routingForms)
    .innerJoin(eventTypes, eq(eventTypes.id, routingForms.defaultEventTypeId))
    .where(ownerWhere(owner))
    .orderBy(desc(routingForms.createdAt))

  const responseCounts = forms.length
    ? await useDatabase().select({ formId: routingResponses.formId, value: count() })
        .from(routingResponses)
        .where(inArray(routingResponses.formId, forms.map(form => form.id)))
        .groupBy(routingResponses.formId)
    : []
  const counts = new Map(responseCounts.map(row => [row.formId, row.value]))
  return forms.map(form => ({
    ...form,
    responseCount: counts.get(form.id) ?? 0,
    createdAt: form.createdAt.toISOString()
  }))
}

export async function getRoutingForm(owner: RoutingOwner, id: string) {
  const [form] = await useDatabase().select().from(routingForms)
    .where(and(eq(routingForms.id, id), ownerWhere(owner))).limit(1)
  if (!form) return null
  const rules = await useDatabase().select({
    name: routingRules.name,
    conditions: routingRules.conditions,
    eventTypeId: routingRules.eventTypeId
  }).from(routingRules).where(eq(routingRules.formId, form.id)).orderBy(asc(routingRules.position))
  return { ...form, rules }
}

async function validateTargets(owner: RoutingOwner, input: RoutingFormInput, executor: Pick<Database, 'select'>) {
  const ids = [...new Set([input.defaultEventTypeId, ...input.rules.map(rule => rule.eventTypeId)])]
  const valid = await executor.select({ id: eventTypes.id }).from(eventTypes)
    .where(and(eventOwnerWhere(owner), inArray(eventTypes.id, ids)))
  if (valid.length !== ids.length) {
    throw createError({ statusCode: 400, statusMessage: 'Choose event types owned by this workspace.' })
  }
}

export async function createRoutingForm(owner: RoutingOwner, input: RoutingFormInput) {
  return useDatabase().transaction(async (tx) => {
    const [total] = await tx.select({ value: count() }).from(routingForms).where(ownerWhere(owner))
    if ((total?.value ?? 0) >= 20) {
      throw createError({ statusCode: 409, statusMessage: 'You have reached the 20 routing form limit.' })
    }
    await validateTargets(owner, input, tx)
    const [form] = await tx.insert(routingForms).values({
      ...owner,
      defaultEventTypeId: input.defaultEventTypeId,
      slug: input.slug,
      title: input.title,
      description: input.description,
      active: input.active,
      questions: input.questions
    }).returning({ id: routingForms.id })
    if (!form) throw new Error('Routing form could not be created.')
    if (input.rules.length) {
      await tx.insert(routingRules).values(input.rules.map((rule, position) => ({
        formId: form.id,
        eventTypeId: rule.eventTypeId,
        name: rule.name,
        conditions: rule.conditions,
        position
      })))
    }
    return form
  })
}

export async function updateRoutingForm(owner: RoutingOwner, id: string, input: RoutingFormInput) {
  return useDatabase().transaction(async (tx) => {
    await validateTargets(owner, input, tx)
    const [updated] = await tx.update(routingForms).set({
      defaultEventTypeId: input.defaultEventTypeId,
      slug: input.slug,
      title: input.title,
      description: input.description,
      active: input.active,
      questions: input.questions,
      updatedAt: sql`now()`
    }).where(and(eq(routingForms.id, id), ownerWhere(owner))).returning({ id: routingForms.id })
    if (!updated) return null
    await tx.delete(routingRules).where(eq(routingRules.formId, id))
    if (input.rules.length) {
      await tx.insert(routingRules).values(input.rules.map((rule, position) => ({
        formId: id,
        eventTypeId: rule.eventTypeId,
        name: rule.name,
        conditions: rule.conditions,
        position
      })))
    }
    return updated
  })
}

export async function deleteRoutingForm(owner: RoutingOwner, id: string) {
  const [history] = await useDatabase().select({ id: routingResponses.id }).from(routingResponses)
    .innerJoin(routingForms, eq(routingForms.id, routingResponses.formId))
    .where(and(eq(routingForms.id, id), ownerWhere(owner))).limit(1)
  if (history) {
    throw createError({ statusCode: 409, statusMessage: 'This form has response history. Turn it off instead.' })
  }
  const [deleted] = await useDatabase().delete(routingForms)
    .where(and(eq(routingForms.id, id), ownerWhere(owner))).returning({ id: routingForms.id })
  return Boolean(deleted)
}

export async function findPublicRoutingForm(ownerSlug: string, formSlug: string, team: boolean) {
  const ownerJoin = team
    ? eq(routingForms.organizationId, organizations.id)
    : eq(routingForms.userId, users.id)
  const ownerFilter = team
    ? sql`lower(${organizations.slug}) = ${ownerSlug.toLowerCase()}`
    : sql`lower(${users.username}) = ${ownerSlug.toLowerCase()}`
  const [form] = await useDatabase().select({
    id: routingForms.id,
    title: routingForms.title,
    description: routingForms.description,
    questions: routingForms.questions,
    defaultEventTypeId: routingForms.defaultEventTypeId,
    userId: routingForms.userId,
    organizationId: routingForms.organizationId,
    ownerSlug: team ? organizations.slug : users.username,
    ownerName: team ? organizations.name : users.name
  }).from(routingForms)
    .innerJoin(team ? organizations : users, ownerJoin)
    .where(and(
      ownerFilter,
      sql`lower(${routingForms.slug}) = ${formSlug.toLowerCase()}`,
      eq(routingForms.active, true),
      ...(team ? [isNull(organizations.archivedAt)] : [eq(users.emailVerified, true)])
    )).limit(1)
  if (!form) return null
  const rules = await useDatabase().select({
    id: routingRules.id,
    name: routingRules.name,
    conditions: routingRules.conditions,
    eventTypeId: routingRules.eventTypeId
  }).from(routingRules).where(eq(routingRules.formId, form.id)).orderBy(asc(routingRules.position))
  return { ...form, rules, team }
}

export async function submitRoutingForm(
  form: NonNullable<Awaited<ReturnType<typeof findPublicRoutingForm>>>,
  input: { name: string, email: string, answers: Record<string, string> }
) {
  for (const question of form.questions) {
    const answer = input.answers[question.id]
    if (question.required && !answer) {
      throw createError({ statusCode: 400, statusMessage: `Answer “${question.label}” before continuing.` })
    }
    if (answer && !question.options.includes(answer)) {
      throw createError({ statusCode: 400, statusMessage: `Choose a valid answer for “${question.label}”.` })
    }
  }
  const rule = routeSubmission(form.rules, input.answers)
  const targetId = rule?.eventTypeId ?? form.defaultEventTypeId
  const [target] = await useDatabase().select({ slug: eventTypes.slug }).from(eventTypes)
    .where(and(
      eq(eventTypes.id, targetId),
      eq(eventTypes.hidden, false),
      form.team
        ? eq(eventTypes.organizationId, form.organizationId!)
        : eq(eventTypes.userId, form.userId!)
    )).limit(1)
  if (!target) throw createError({ statusCode: 409, statusMessage: 'The matching booking option is not available right now.' })

  await useDatabase().insert(routingResponses).values({
    formId: form.id,
    matchedRuleId: rule?.id ?? null,
    eventTypeId: targetId,
    respondentName: input.name,
    respondentEmail: input.email,
    answers: input.answers
  })
  const path = form.team
    ? `/team/${encodeURIComponent(form.ownerSlug)}/${encodeURIComponent(target.slug)}`
    : `/${encodeURIComponent(form.ownerSlug)}/${encodeURIComponent(target.slug)}`
  return { redirectUrl: path, matchedRule: rule?.name ?? null }
}
