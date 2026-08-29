import { onScopeDispose, ref, watch } from 'vue'
import { LIST_SEARCH_DEBOUNCE_MS } from '~/constants/lists'

export function useDebouncedSearch(options: {
  debounceMs?: number
  onSearch?: () => void
} = {}) {
  const query = ref('')
  const search = ref('')
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  function clearSearch() {
    clearTimeout(searchTimer)
    query.value = ''
    search.value = ''
    options.onSearch?.()
  }

  watch(query, (value) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      search.value = value.trim()
      options.onSearch?.()
    }, options.debounceMs ?? LIST_SEARCH_DEBOUNCE_MS)
  })

  onScopeDispose(() => clearTimeout(searchTimer))

  return { query, search, clearSearch }
}
