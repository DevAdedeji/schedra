import { eq } from 'drizzle-orm'
import {
  DEFAULT_PERSONAL_BRANDING,
  type BookingPageTheme,
  type PublicPersonalBranding
} from '#shared/branding'
import { users } from '../database/schema'
import { useDatabase } from '../database'
import { personalPlanEntitlement } from './personal-entitlement'

export async function storedPersonalBranding(userId: string) {
  const [[row], entitlement] = await Promise.all([
    useDatabase().select({
      brandName: users.brandName,
      logoUrl: users.brandLogoUrl,
      brandColor: users.brandColor,
      brandDarkColor: users.brandDarkColor,
      bookingPageTheme: users.bookingPageTheme,
      hideSchedraBranding: users.hideSchedraBranding
    }).from(users).where(eq(users.id, userId)).limit(1),
    personalPlanEntitlement(userId)
  ])

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Your profile could not be found.' })
  return {
    branding: {
      brandName: row.brandName,
      logoUrl: row.logoUrl,
      brandColor: row.brandColor ?? DEFAULT_PERSONAL_BRANDING.brandColor,
      brandDarkColor: row.brandDarkColor ?? DEFAULT_PERSONAL_BRANDING.brandDarkColor,
      bookingPageTheme: row.bookingPageTheme as BookingPageTheme,
      hideSchedraBranding: row.hideSchedraBranding
    } satisfies PublicPersonalBranding,
    entitlement
  }
}

export async function publicPersonalBranding(userId: string): Promise<PublicPersonalBranding> {
  const stored = await storedPersonalBranding(userId)
  if (!stored.entitlement.isPro) return DEFAULT_PERSONAL_BRANDING
  return stored.branding
}
