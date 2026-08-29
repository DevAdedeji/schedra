import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useDebouncedSearch } from './useDebouncedSearch'

type AsyncDataStatus = 'idle' | 'pending' | 'success' | 'error'

export function useListQueryState(options: { debounceMs?: number } = {}) {
  const page = ref(1)
  function resetPage() {
    page.value = 1
  }

  const { query, search, clearSearch } = useDebouncedSearch({
    debounceMs: options.debounceMs,
    onSearch: resetPage
  })

  return { page, query, search, resetPage, clearSearch }
}

export function useListLoadingState<T>(
  status: MaybeRefOrGetter<AsyncDataStatus>,
  data: MaybeRefOrGetter<T | null | undefined>,
  failure?: MaybeRefOrGetter<unknown>
) {
  const initialLoading = computed(() => toValue(status) === 'pending' && !toValue(data))
  const refreshing = computed(() => toValue(status) === 'pending' && Boolean(toValue(data)))
  const blockingFailure = computed(() => Boolean(failure && toValue(failure) && !toValue(data)))

  return { initialLoading, refreshing, blockingFailure }
}
