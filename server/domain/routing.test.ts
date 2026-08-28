import { describe, expect, it } from 'vitest'
import { matchesRoutingCondition, routeSubmission, routingFormInputSchema } from '#shared/routing'

const questionId = '11111111-1111-4111-8111-111111111111'
const salesEvent = '22222222-2222-4222-8222-222222222222'

describe('routing decisions', () => {
  it('uses the first route whose every condition matches', () => {
    const rules = [
      {
        id: 'first',
        name: 'Enterprise sales',
        eventTypeId: salesEvent,
        conditions: [{ questionId, operator: 'equals' as const, value: 'Enterprise' }]
      },
      {
        id: 'second',
        name: 'Backup',
        eventTypeId: salesEvent,
        conditions: [{ questionId, operator: 'contains' as const, value: 'enter' }]
      }
    ]
    expect(routeSubmission(rules, { [questionId]: 'Enterprise' })?.id).toBe('first')
    expect(routeSubmission(rules, { [questionId]: 'Personal' })).toBeNull()
  })

  it('supports negative and case-insensitive contains conditions', () => {
    expect(matchesRoutingCondition({ questionId, operator: 'not_equals', value: 'Support' }, { [questionId]: 'Sales' })).toBe(true)
    expect(matchesRoutingCondition({ questionId, operator: 'contains', value: 'ENTER' }, { [questionId]: 'Enterprise' })).toBe(true)
  })

  it('rejects routes that reference missing questions or answers', () => {
    const result = routingFormInputSchema.safeParse({
      title: 'Find a meeting', slug: 'find-a-meeting', active: true,
      defaultEventTypeId: salesEvent,
      questions: [{ id: questionId, label: 'What do you need?', options: ['Sales', 'Support'], required: true }],
      rules: [{
        name: 'Invalid route', eventTypeId: salesEvent,
        conditions: [{ questionId, operator: 'equals', value: 'Billing' }]
      }]
    })
    expect(result.success).toBe(false)
  })
})
