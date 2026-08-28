import { z } from 'zod'
import { paginationQuerySchema } from './pagination'

export const paymentActivityQuerySchema = paginationQuerySchema.extend({
  direction: z.enum(['all', 'in', 'out']).default('all'),
  status: z.enum(['all', 'pending', 'succeeded', 'failed', 'expired']).default('all')
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
