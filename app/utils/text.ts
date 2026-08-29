export function getInitials(value: string, maximum = 2) {
  return value
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, maximum)
    .join('')
    .toUpperCase()
}
