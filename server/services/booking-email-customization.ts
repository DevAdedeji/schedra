import { eq } from 'drizzle-orm'
import {
  readBookingEmailTemplateSettings,
  renderBookingEmailTemplate,
  type BookingEmailTemplateKey,
  type BookingEmailTemplateSettings
} from '#shared/email-templates'
import { DEFAULT_PERSONAL_BRANDING } from '#shared/branding'
import type { Database } from '../database/client'
import { organizations, users } from '../database/schema'
import { useDatabase } from '../database'
import type { Email, EmailBranding } from '../integrations/email'
import { useEnv } from '../config/env'
import { organizationEntitlement } from './entitlement'
import { personalPlanEntitlement } from './personal-entitlement'

export interface BookingEmailOwner {
  organizationId?: string | null
  hostUserId?: string
  hostName: string
  attendeeName: string
  attendeeTimeZone: string
  eventTitle: string
  startsAt: string
}

export type BookingEmailCustomizationExecutor = Pick<Database, 'select'>

export interface BookingEmailCustomization {
  settings: BookingEmailTemplateSettings
  branding: EmailBranding
}

function absoluteLogoUrl(value: string | null) {
  if (!value) return undefined
  try {
    return new URL(value, useEnv().schedraUrl).toString()
  } catch {
    return undefined
  }
}

function bookingTime(startsAt: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone
  }).format(new Date(startsAt))
}

export async function resolveBookingEmailCustomization(
  owner: Pick<BookingEmailOwner, 'organizationId' | 'hostUserId' | 'hostName'>,
  executor: BookingEmailCustomizationExecutor = useDatabase()
): Promise<BookingEmailCustomization | null> {
  if (owner.organizationId) {
    const [entitlement, [stored]] = await Promise.all([
      organizationEntitlement(owner.organizationId),
      executor.select({
        name: organizations.name,
        logoUrl: organizations.logo,
        accentColor: organizations.brandColor,
        hideSchedraBranding: organizations.hideSchedraBranding,
        settings: organizations.bookingEmailTemplates
      }).from(organizations).where(eq(organizations.id, owner.organizationId)).limit(1)
    ])
    if (!stored || entitlement.readOnly) return null
    return {
      settings: readBookingEmailTemplateSettings(stored.settings),
      branding: {
        name: stored.name,
        logoUrl: absoluteLogoUrl(stored.logoUrl),
        accentColor: stored.accentColor ?? DEFAULT_PERSONAL_BRANDING.brandColor,
        hideSchedraBranding: stored.hideSchedraBranding
      }
    }
  }

  if (!owner.hostUserId) return null
  const [entitlement, [stored]] = await Promise.all([
    personalPlanEntitlement(owner.hostUserId),
    executor.select({
      name: users.name,
      brandName: users.brandName,
      logoUrl: users.brandLogoUrl,
      accentColor: users.brandColor,
      hideSchedraBranding: users.hideSchedraBranding,
      settings: users.bookingEmailTemplates
    }).from(users).where(eq(users.id, owner.hostUserId)).limit(1)
  ])
  if (!stored || !entitlement.isPro) return null
  return {
    settings: readBookingEmailTemplateSettings(stored.settings),
    branding: {
      name: stored.brandName || stored.name || owner.hostName,
      logoUrl: absoluteLogoUrl(stored.logoUrl),
      accentColor: stored.accentColor ?? DEFAULT_PERSONAL_BRANDING.brandColor,
      hideSchedraBranding: stored.hideSchedraBranding
    }
  }
}

export function customizeGuestBookingEmail(
  key: BookingEmailTemplateKey,
  email: Email,
  booking: BookingEmailOwner,
  customization: BookingEmailCustomization | null
): Email {
  if (!customization) return email
  const template = customization.settings.templates[key]
  const rendered = template
    ? renderBookingEmailTemplate(template, {
        '{{guest_name}}': booking.attendeeName,
        '{{event_name}}': booking.eventTitle,
        '{{host_name}}': booking.hostName,
        '{{start_time}}': bookingTime(booking.startsAt, booking.attendeeTimeZone),
        '{{time_zone}}': booking.attendeeTimeZone
      })
    : null

  return {
    ...email,
    ...(rendered ?? {}),
    ...(rendered ? { preheader: rendered.body.split('\n')[0] } : {}),
    footer: customization.settings.footer ?? email.footer,
    branding: customization.branding
  }
}
