import { z } from 'zod'

export const bookingPageThemes = ['system', 'light', 'dark'] as const
export type BookingPageTheme = typeof bookingPageThemes[number]

const hexColorSchema = z.string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex colour such as #1D4ED8.')
  .transform(value => value.toUpperCase())

export const personalBrandingSchema = z.object({
  brandName: z.string().trim().max(80, 'Keep the brand name under 80 characters.').nullable(),
  brandColor: hexColorSchema,
  brandDarkColor: hexColorSchema,
  bookingPageTheme: z.enum(bookingPageThemes),
  hideSchedraBranding: z.boolean()
})

export type PersonalBrandingInput = z.infer<typeof personalBrandingSchema>

export interface PublicPersonalBranding {
  brandName: string | null
  logoUrl: string | null
  brandColor: string
  brandDarkColor: string
  bookingPageTheme: BookingPageTheme
  hideSchedraBranding: boolean
}

export const DEFAULT_PERSONAL_BRANDING: PublicPersonalBranding = {
  brandName: null,
  logoUrl: null,
  brandColor: '#FF3D00',
  brandDarkColor: '#FF6F42',
  bookingPageTheme: 'system',
  hideSchedraBranding: false
}

function srgbChannel(value: number) {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

export function readableTextColor(hex: string) {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  const luminance = 0.2126 * srgbChannel(red) + 0.7152 * srgbChannel(green) + 0.0722 * srgbChannel(blue)
  return luminance > 0.45 ? '#1C1917' : '#FFFFFF'
}
