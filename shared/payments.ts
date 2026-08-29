import { z } from 'zod'

export const paymentCurrencySchema = z.enum(['USD', 'NGN'])
export type PaymentCurrency = z.infer<typeof paymentCurrencySchema>

export const paymentConfigurationSchema = z.object({
  paymentEnabled: z.boolean().default(false),
  priceCents: z.number().int().min(100, 'Price must be at least 1.00.').max(100_000_000).nullable().default(null),
  paymentCurrency: paymentCurrencySchema.default('USD')
}).superRefine((value, context) => {
  if (value.paymentEnabled && value.priceCents === null) {
    context.addIssue({ code: 'custom', path: ['priceCents'], message: 'Add a price for this booking.' })
  }
  if (!value.paymentEnabled && value.priceCents !== null) {
    context.addIssue({ code: 'custom', path: ['priceCents'], message: 'Turn payments on before setting a price.' })
  }
})

export type PaymentConfiguration = z.infer<typeof paymentConfigurationSchema>

export const withdrawalPreviewInputSchema = z.object({
  destinationId: z.string().trim().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/),
  sourceCurrency: paymentCurrencySchema,
  amountCents: z.number().int().min(1).max(100_000_000)
})

export const withdrawalCreateInputSchema = z.object({
  requestId: z.uuid(),
  confirmationToken: z.string().min(32).max(4096)
})

export type WithdrawalPreviewInput = z.infer<typeof withdrawalPreviewInputSchema>
export type WithdrawalCreateInput = z.infer<typeof withdrawalCreateInputSchema>

export function formatMoney(cents: number, currency: PaymentCurrency) {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100)
}
