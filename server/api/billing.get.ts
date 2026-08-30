import { desc, eq } from 'drizzle-orm'
import { personalInvoices, personalSubscriptions } from '../database/schema'
import { useDatabase } from '../database'
import { bachsConfigured } from '../integrations/bachs'
import { personalPlanEntitlement } from '../services/personal-entitlement'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const [entitlement, invoices, [subscription]] = await Promise.all([
    personalPlanEntitlement(session.user.id),
    useDatabase().select({
      id: personalInvoices.id,
      reference: personalInvoices.reference,
      status: personalInvoices.status,
      interval: personalInvoices.interval,
      amountCents: personalInvoices.amountCents,
      collectionCurrency: personalInvoices.collectionCurrency,
      periodStart: personalInvoices.periodStart,
      periodEnd: personalInvoices.periodEnd,
      paidAt: personalInvoices.paidAt,
      createdAt: personalInvoices.createdAt
    }).from(personalInvoices)
      .where(eq(personalInvoices.userId, session.user.id))
      .orderBy(desc(personalInvoices.createdAt))
      .limit(24),
    useDatabase().select({
      collectionMethod: personalSubscriptions.collectionMethod,
      collectionCurrency: personalSubscriptions.collectionCurrency
    }).from(personalSubscriptions)
      .where(eq(personalSubscriptions.userId, session.user.id))
      .limit(1)
  ])

  return {
    entitlement,
    configured: bachsConfigured(),
    payment: {
      collectionMethod: subscription?.collectionMethod ?? 'invoice',
      collectionCurrency: subscription?.collectionCurrency ?? 'USD'
    },
    invoices: invoices.map(invoice => ({
      ...invoice,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString()
    }))
  }
})
