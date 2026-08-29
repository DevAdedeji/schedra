<template>
  <div
    class="divide-y divide-default"
    aria-label="Loading calendar preferences"
    aria-busy="true"
    role="status"
  >
    <div
      class="flex items-center justify-between gap-3 px-5 py-4 sm:px-6"
      aria-hidden="true"
    >
      <div class="flex min-w-0 items-center gap-3">
        <USkeleton class="size-8 shrink-0 rounded-lg" />
        <div class="min-w-0 space-y-2">
          <USkeleton class="h-3 w-32 rounded" />
          <USkeleton class="h-2.5 w-48 max-w-full rounded" />
        </div>
      </div>
      <USkeleton class="h-8 w-28 shrink-0 rounded-lg" />
    </div>

    <div
      class="space-y-3 px-5 py-5 sm:px-6"
      aria-hidden="true"
    >
      <USkeleton class="h-4 w-56 rounded" />
      <USkeleton class="h-3 w-full max-w-lg rounded" />
      <div class="overflow-hidden rounded-xl border border-default">
        <div
          v-for="row in 4"
          :key="row"
          class="flex items-center gap-3 border-b border-default px-3.5 py-3 last:border-b-0"
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
      class="space-y-3 px-5 py-5 sm:px-6"
      aria-hidden="true"
    >
      <USkeleton class="h-4 w-48 rounded" />
      <USkeleton class="h-3 w-full max-w-lg rounded" />
      <USkeleton class="h-9 w-full max-w-sm rounded-lg" />
      <USkeleton class="h-16 w-full max-w-2xl rounded-xl" />
    </div>
  </div>
</template>
