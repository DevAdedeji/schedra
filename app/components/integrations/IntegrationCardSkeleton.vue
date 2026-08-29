<template>
  <section
    class="flex min-h-56 flex-col rounded-xl border border-default bg-default p-5"
    aria-label="Loading integration status"
  >
    <div class="flex items-start justify-between gap-3">
      <USkeleton class="size-11 rounded-xl" />
      <USkeleton class="h-5 w-20 rounded-full" />
    </div>
    <USkeleton class="mt-4 h-5 w-36" />
    <div class="mt-2 space-y-2">
      <USkeleton class="h-3 w-full" />
      <USkeleton class="h-3 w-4/5" />
    </div>
    <USkeleton class="mt-auto h-10 w-full rounded-lg" />
  </section>
</template>
