export function useCopy(resetAfter = 1600) {
  const copied = ref(false)
  const failed = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string) {
    const written = await navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false)

    clearTimeout(timer)
    copied.value = written
    failed.value = !written
    timer = setTimeout(() => {
      copied.value = false
      failed.value = false
    }, resetAfter)

    return written
  }

  onScopeDispose(() => clearTimeout(timer))

  return { copied, failed, copy }
}
