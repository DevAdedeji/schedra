import { desc, eq } from 'drizzle-orm'
import {
  organizationInvoices,
  organizationSubscriptions,
  subscriptionSeatSyncJobs
} from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { bachsConfigured } from '../../../integrations/bachs'
import { organizationEntitlement } from '../../../services/entitlement'
import { requireOrganizationPermission } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })

  const [entitlement, invoices, [subscription], [seatJob]] = await Promise.all([
    organizationEntitlement(context.organization.id),
    useDatabase().select({
      id: organizationInvoices.id,
      reference: organizationInvoices.reference,
      status: organizationInvoices.status,
      interval: organizationInvoices.interval,
      seats: organizationInvoices.seats,
      amountCents: organizationInvoices.amountCents,
      collectionCurrency: organizationInvoices.collectionCurrency,
      periodStart: organizationInvoices.periodStart,
      periodEnd: organizationInvoices.periodEnd,
      paidAt: organizationInvoices.paidAt,
      createdAt: organizationInvoices.createdAt
    }).from(organizationInvoices)
      .where(eq(organizationInvoices.organizationId, context.organization.id))
      .orderBy(desc(organizationInvoices.createdAt))
      .limit(24),
    useDatabase().select({
      billedSeats: organizationSubscriptions.seatsAtLastInvoice,
      collectionMethod: organizationSubscriptions.collectionMethod,
      collectionCurrency: organizationSubscriptions.collectionCurrency
    }).from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, context.organization.id))
      .limit(1),
    useDatabase().select({
      status: subscriptionSeatSyncJobs.status,
      lastError: subscriptionSeatSyncJobs.lastError,
      updatedAt: subscriptionSeatSyncJobs.updatedAt
    }).from(subscriptionSeatSyncJobs)
      .where(eq(subscriptionSeatSyncJobs.organizationId, context.organization.id))
      .limit(1)
  ])

  return {
    entitlement,
    configured: bachsConfigured(),
    seatBilling: {
      billedSeats: subscription?.billedSeats ?? null,
      collectionMethod: subscription?.collectionMethod ?? 'invoice',
      collectionCurrency: subscription?.collectionCurrency ?? 'USD',
      syncStatus: seatJob?.status ?? null,
      hasError: Boolean(seatJob?.lastError),
      updatedAt: seatJob?.updatedAt.toISOString() ?? null
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
