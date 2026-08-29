export function useCopy(resetAfter = 1600) {
  const copied = ref(false)
  const copiedKey = ref<string | null>(null)
  const failed = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string, key = 'default') {
    const written = await navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false)

    clearTimeout(timer)
    copied.value = written
    copiedKey.value = written ? key : null
    failed.value = !written
    timer = setTimeout(() => {
      copied.value = false
      copiedKey.value = null
      failed.value = false
    }, resetAfter)

    return written
  }

  function isCopied(key = 'default') {
    return copied.value && copiedKey.value === key
  }

  onScopeDispose(() => clearTimeout(timer))

  return { copied, copiedKey, failed, copy, isCopied }
}
