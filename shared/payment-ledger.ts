import { z } from 'zod'
import { paginationQuerySchema } from './pagination'

export const paymentActivityQuerySchema = paginationQuerySchema.extend({
  direction: z.enum(['all', 'in', 'out']).default('all'),
  status: z.enum(['all', 'pending', 'succeeded', 'failed', 'expired']).default('all'),
  from: z.preprocess(value => value === '' ? undefined : value, z.iso.date().optional()),
  to: z.preprocess(value => value === '' ? undefined : value, z.iso.date().optional())
}).refine(query => !query.from || !query.to || query.from <= query.to, {
  message: 'The start date must be before the end date.',
  path: ['from']
})

export type PaymentActivityQuery = z.infer<typeof paymentActivityQuerySchema>

export const paymentLedgerKinds = [
  'checkout',
  'customer_payment',
  'platform_fee',
  'processing_fee',
  'settlement',
  'refund'
] as const

export type PaymentLedgerKind = typeof paymentLedgerKinds[number]
export type PaymentLedgerDirection = 'none' | 'in' | 'out'
export type PaymentLedgerStatus = 'pending' | 'succeeded' | 'failed' | 'expired'
