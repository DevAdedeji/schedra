import { readableTextColor, type PublicPersonalBranding } from '#shared/branding'

export function usePersonalBookingBranding(branding: ComputedRef<PublicPersonalBranding | undefined>) {
  const brandStyle = computed(() => {
    if (!branding.value) return undefined
    return {
      '--booking-brand-light': branding.value.brandColor,
      '--booking-brand-dark': branding.value.brandDarkColor,
      '--booking-brand-light-contrast': readableTextColor(branding.value.brandColor),
      '--booking-brand-dark-contrast': readableTextColor(branding.value.brandDarkColor)
    }
  })

  const brandThemeClass = computed(() => {
    if (branding.value?.bookingPageTheme === 'dark') return 'dark'
    if (branding.value?.bookingPageTheme === 'light') return 'light'
    return undefined
  })

  return { brandStyle, brandThemeClass }
}
