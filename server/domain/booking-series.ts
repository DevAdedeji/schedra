interface SeriesOccurrence {
  id: string
  rescheduledFromId: string | null
  position: number | null
}

export function currentSeriesOccurrences<T extends SeriesOccurrence>(items: T[], expectedCount: number): T[] {
  const replaced = new Set(items.flatMap(item => item.rescheduledFromId ? [item.rescheduledFromId] : []))
  const current = items.filter(item => !replaced.has(item.id)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  if (current.length !== expectedCount || current.some((item, index) => item.position !== index + 1)) {
    throw new Error('A recurring booking series is incomplete.')
  }
  return current
}
