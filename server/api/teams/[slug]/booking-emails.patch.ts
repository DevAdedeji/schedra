import { bookingEmailTemplateSettingsSchema } from '#shared/email-templates'
import { saveTeamBookingEmailTemplateSettings } from '../../../services/booking-email-template-settings'
import { assertTeamWritable } from '../../../services/entitlement'
import { recordAudit, requireOrganizationPermission } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { organization: ['update'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, bookingEmailTemplateSettingsSchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Check the email template settings.'
    })
  }
  const settings = await saveTeamBookingEmailTemplateSettings(context.organization.id, parsed.data)
  await recordAudit({
    organizationId: context.organization.id,
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    action: 'organization.booking_email_templates_updated',
    targetType: 'organization',
    targetId: context.organization.id
  })
  return { settings }
})
