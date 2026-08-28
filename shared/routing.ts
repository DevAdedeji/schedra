import { z } from 'zod'
import { emailSchema, eventTypeSlugSchema } from './validation'

export const routingOperatorSchema = z.enum(['equals', 'not_equals', 'contains'])

export const routingQuestionSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(2).max(120),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(20)
    .transform(values => [...new Set(values)]),
  required: z.boolean().default(true)
})

export const routingConditionSchema = z.object({
  questionId: z.uuid(),
  operator: routingOperatorSchema,
  value: z.string().trim().min(1).max(80)
})

export const routingRuleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  conditions: z.array(routingConditionSchema).min(1).max(10),
  eventTypeId: z.uuid()
})

export const routingFormInputSchema = z.object({
  title: z.string().trim().min(2).max(100),
  slug: eventTypeSlugSchema,
  description: z.string().trim().max(500).nullable().default(null),
  active: z.boolean().default(true),
  defaultEventTypeId: z.uuid(),
  questions: z.array(routingQuestionSchema).min(1).max(10),
  rules: z.array(routingRuleSchema).max(20)
}).superRefine((form, context) => {
  const questions = new Map(form.questions.map(question => [question.id, question]))
  for (const [ruleIndex, rule] of form.rules.entries()) {
    for (const [conditionIndex, condition] of rule.conditions.entries()) {
      const question = questions.get(condition.questionId)
      if (!question) {
        context.addIssue({
          code: 'custom',
          path: ['rules', ruleIndex, 'conditions', conditionIndex, 'questionId'],
          message: 'Choose a question from this form.'
        })
      } else if (!question.options.includes(condition.value)) {
        context.addIssue({
          code: 'custom',
          path: ['rules', ruleIndex, 'conditions', conditionIndex, 'value'],
          message: 'Choose one of that question’s answers.'
        })
      }
    }
  }
})

export const routingSubmissionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  answers: z.record(z.uuid(), z.string().trim().max(80))
})

export type RoutingFormInput = z.infer<typeof routingFormInputSchema>
export type RoutingQuestion = z.infer<typeof routingQuestionSchema>
export type RoutingRule = z.infer<typeof routingRuleSchema>
export type RoutingCondition = z.infer<typeof routingConditionSchema>

export function matchesRoutingCondition(condition: RoutingCondition, answers: Record<string, string>) {
  const answer = answers[condition.questionId] ?? ''
  if (condition.operator === 'equals') return answer === condition.value
  if (condition.operator === 'not_equals') return answer !== condition.value
  return answer.toLocaleLowerCase().includes(condition.value.toLocaleLowerCase())
}

export function routeSubmission<T extends RoutingRule>(rules: T[], answers: Record<string, string>): T | null {
  return rules.find(rule => rule.conditions.every(condition => matchesRoutingCondition(condition, answers))) ?? null
}
