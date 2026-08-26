export const EMBED_MESSAGE_SOURCE = 'schedra-embed'
export const EMBED_MESSAGE_VERSION = 1

export const embedThemes = ['auto', 'light', 'dark'] as const
export type EmbedTheme = typeof embedThemes[number]

export interface EmbedBookingResult {
  uid: string
  start: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'rejected'
}

export interface EmbedMessage {
  source: typeof EMBED_MESSAGE_SOURCE
  version: typeof EMBED_MESSAGE_VERSION
  type: 'ready' | 'resize' | 'booking.completed' | 'close'
  payload?: Record<string, unknown> | EmbedBookingResult
}

export function normalizeEmbedTheme(value: unknown): EmbedTheme {
  return typeof value === 'string' && embedThemes.includes(value as EmbedTheme)
    ? value as EmbedTheme
    : 'auto'
}

export function normalizeEmbedAccent(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null
}

export function normalizeParentOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

export function embedPathForBookingPath(path: string): string {
  const segments = path.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean)
  if (segments[0] === 'team' && segments.length === 3) {
    return `/embed/team/${encodeURIComponent(decodeURIComponent(segments[1]!))}/${encodeURIComponent(decodeURIComponent(segments[2]!))}`
  }
  if (segments.length === 2) {
    return `/embed/personal/${encodeURIComponent(decodeURIComponent(segments[0]!))}/${encodeURIComponent(decodeURIComponent(segments[1]!))}`
  }
  throw new Error('Use a personal or team event-type booking link.')
}
