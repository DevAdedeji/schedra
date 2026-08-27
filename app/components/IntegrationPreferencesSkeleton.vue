<template>
  <div
    class="divide-y divide-default"
    aria-label="Loading calendar preferences"
    aria-busy="true"
    role="status"
  >
    <div
      class="grid gap-6 px-5 py-6 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:px-7"
      aria-hidden="true"
    >
      <div class="space-y-2">
        <USkeleton class="h-4 w-48 rounded" />
        <USkeleton class="h-3 w-full max-w-xs rounded" />
        <USkeleton class="h-3 w-4/5 max-w-xs rounded" />
      </div>
      <div class="overflow-hidden rounded-lg border border-default">
        <div
          v-for="row in 4"
          :key="row"
          class="flex items-center gap-3 border-b border-default px-4 py-3 last:border-b-0"
        >
          <USkeleton class="size-4 shrink-0 rounded" />
          <USkeleton class="size-2.5 shrink-0 rounded-full" />
          <div class="min-w-0 flex-1 space-y-2">
            <USkeleton class="h-3 w-2/3 rounded" />
            <USkeleton class="h-2.5 w-1/2 rounded" />
          </div>
        </div>
      </div>
    </div>

    <div
      class="grid gap-6 px-5 py-6 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:px-7"
      aria-hidden="true"
    >
      <div class="space-y-2">
        <USkeleton class="h-4 w-40 rounded" />
        <USkeleton class="h-3 w-full max-w-xs rounded" />
        <USkeleton class="h-3 w-3/4 max-w-xs rounded" />
      </div>
      <USkeleton class="h-10 w-full rounded-lg" />
    </div>

    <div
      class="surface-secondary flex items-center justify-between gap-4 px-5 py-5 sm:px-7"
      aria-hidden="true"
    >
      <USkeleton class="h-3 w-52 rounded" />
      <USkeleton class="h-9 w-36 rounded-lg" />
    </div>
  </div>
</template>
