import { desc, eq } from 'drizzle-orm'
import { organizationInvoices } from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { bachsConfigured } from '../../../integrations/bachs'
import { organizationEntitlement } from '../../../services/entitlement'
import { requireOrganizationPermission } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })

  const [entitlement, invoices] = await Promise.all([
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
      .limit(24)
  ])

  return {
    entitlement,
    configured: bachsConfigured(),
    invoices: invoices.map(invoice => ({
      ...invoice,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString()
    }))
  }
})
