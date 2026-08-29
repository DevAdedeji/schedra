import { Temporal } from '@js-temporal/polyfill'

export type DateTimeInput = string | number | Date

function dateValue(value: DateTimeInput) {
  return value instanceof Date ? value : new Date(value)
}

export function localTimeZone(fallback = 'UTC') {
  try {
    return Temporal.Now.timeZoneId()
  } catch {
    return fallback
  }
}

export function formatInstant(
  value: DateTimeInput,
  options: Intl.DateTimeFormatOptions,
  locale?: string | string[]
) {
  return new Intl.DateTimeFormat(locale, options).format(dateValue(value))
}

export function formatDateTime(value: DateTimeInput, locale: string | string[] = 'en', timeZone?: string) {
  return formatInstant(value, { dateStyle: 'medium', timeStyle: 'short', timeZone }, locale)
}

export function formatDate(value: DateTimeInput, locale?: string | string[], timeZone?: string) {
  return formatInstant(value, { dateStyle: 'medium', timeZone }, locale)
}

export function formatTime(value: DateTimeInput, timeZone: string, locale: string | string[] = 'en-GB') {
  return formatInstant(value, { hour: '2-digit', minute: '2-digit', timeZone }, locale)
}

export function calendarDateKey(value: DateTimeInput, timeZone: string) {
  return Temporal.Instant.from(dateValue(value).toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString()
}

export function todayCalendarDate(timeZone = localTimeZone()) {
  return Temporal.Now.instant().toZonedDateTimeISO(timeZone).toPlainDate().toString()
}

export function localCalendarDate(value: Date) {
  return Temporal.PlainDate.from({
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate()
  }).toString()
}

export function localDateFromCalendarDate(value: string) {
  const date = Temporal.PlainDate.from(value)
  return new Date(date.year, date.month - 1, date.day)
}

export function addLocalCalendarDays(value: Date, days: number) {
  return localDateFromCalendarDate(addCalendarDateDays(localCalendarDate(value), days))
}

export function addCalendarDateDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({ days }).toString()
}

export function startOfIsoWeek(date: string) {
  const value = Temporal.PlainDate.from(date)
  return value.subtract({ days: value.dayOfWeek - 1 }).toString()
}

export function calendarDaysBetween(from: string, to: string) {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'day' }).days
}

export function calendarDateAsUtcNoon(date: string) {
  return new Date(`${Temporal.PlainDate.from(date)}T12:00:00Z`)
}

export function formatCalendarDate(
  date: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string | string[]
) {
  return formatInstant(calendarDateAsUtcNoon(date), { ...options, timeZone: 'UTC' }, locale)
}

export function addExactTime(value: DateTimeInput, duration: Temporal.DurationLike) {
  return new Date(Temporal.Instant.from(dateValue(value).toISOString()).add(duration).epochMilliseconds)
}

export function subtractExactTime(value: DateTimeInput, duration: Temporal.DurationLike) {
  return new Date(Temporal.Instant.from(dateValue(value).toISOString()).subtract(duration).epochMilliseconds)
}

export function isPast(value: DateTimeInput, now: DateTimeInput = Date.now()) {
  return dateValue(value).getTime() < dateValue(now).getTime()
}

export function compactRelativeTime(value: DateTimeInput, now: DateTimeInput = Date.now()) {
  const seconds = Math.round((dateValue(now).getTime() - dateValue(value).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
