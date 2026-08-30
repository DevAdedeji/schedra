import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'

const awayPeriodBaseSchema = z.object({
  name: z.string().trim().min(1, 'Give this time off a name.').max(80, 'Keep the name under 80 characters.'),
  startDate: z.iso.date(),
  endDate: z.iso.date()
})

export const awayPeriodInputSchema = awayPeriodBaseSchema.superRefine((value, context) => {
  if (value.endDate < value.startDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'The end date must be on or after the start date.'
    })
    return
  }

  const start = Temporal.PlainDate.from(value.startDate)
  const end = Temporal.PlainDate.from(value.endDate)
  const days = start.until(end, { largestUnit: 'day' }).days + 1
  if (days > 730) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'Time off can cover at most two years.'
    })
  }
})

export type AwayPeriodInput = z.infer<typeof awayPeriodInputSchema>
