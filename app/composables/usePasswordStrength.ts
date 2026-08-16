export interface PasswordStrength {
  score: 0 | 1 | 2 | 3
  label: string
  barClass: string
  textClass: string
}

const SEQUENCES = ['password', 'qwerty', '12345', 'letmein', 'welcome', 'schedra', 'abcdef']

export function usePasswordStrength(password: Ref<string>) {
  return computed<PasswordStrength>(() => {
    const value = password.value
    const empty = { score: 0, label: '', barClass: '', textClass: '' } as const

    if (!value) return { ...empty }

    const lower = value.toLowerCase()
    const predictable = SEQUENCES.some(seed => lower.includes(seed))

    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]
      .filter(pattern => pattern.test(value)).length

    let score: 1 | 2 | 3 = 1
    if (value.length >= 14 && classes >= 2) score = 2
    if (value.length >= 20 || (value.length >= 16 && classes >= 3)) score = 3
    if (predictable) score = 1

    if (score === 3) {
      return { score, label: 'Strong', barClass: 'bg-green-500', textClass: 'text-green-600 dark:text-green-500' }
    }

    if (score === 2) {
      return { score, label: 'Fair', barClass: 'bg-amber-500', textClass: 'text-amber-600 dark:text-amber-500' }
    }

    return {
      score,
      label: predictable ? 'Too predictable' : 'Weak',
      barClass: 'bg-red-500',
      textClass: 'text-red-600 dark:text-red-500'
    }
  })
}
