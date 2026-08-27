<template>
  <div
    class="space-y-7"
    aria-label="Loading overview"
    aria-busy="true"
    role="status"
  >
    <section
      class="grid overflow-hidden rounded-xl border border-default bg-default lg:grid-cols-[minmax(0,1fr)_18rem]"
      aria-hidden="true"
    >
      <div class="space-y-3 px-5 py-6 sm:px-6">
        <USkeleton class="h-3 w-28 rounded" />
        <USkeleton class="h-5 w-44 rounded" />
        <USkeleton class="h-3 w-full max-w-md rounded" />
        <USkeleton class="mt-5 h-16 w-full max-w-2xl rounded-xl" />
      </div>
      <div class="surface-secondary space-y-3 border-t border-default px-5 py-5 lg:border-l lg:border-t-0">
        <USkeleton class="size-9 rounded-lg" />
        <USkeleton class="h-4 w-36 rounded" />
        <USkeleton class="h-3 w-full rounded" />
        <USkeleton class="h-8 w-36 rounded-lg" />
      </div>
    </section>

    <div
      class="grid grid-cols-2 gap-3 lg:grid-cols-4"
      aria-hidden="true"
    >
      <div
        v-for="index in 4"
        :key="index"
        class="space-y-3 rounded-xl border border-default bg-default px-4 py-4 sm:px-5"
      >
        <div class="flex justify-between gap-3">
          <USkeleton class="h-3 w-20 rounded" />
          <USkeleton class="size-4 rounded" />
        </div>
        <USkeleton class="h-7 w-10 rounded" />
        <USkeleton class="hidden h-3 w-28 rounded sm:block" />
      </div>
    </div>

    <div
      class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]"
      aria-hidden="true"
    >
      <section class="overflow-hidden rounded-xl border border-default bg-default">
        <div class="space-y-2 border-b border-default px-5 py-4">
          <USkeleton class="h-4 w-24 rounded" />
          <USkeleton class="h-3 w-64 max-w-full rounded" />
        </div>
        <div class="space-y-4 px-5 py-5">
          <div
            v-for="index in 3"
            :key="index"
            class="flex items-center gap-4"
          >
            <USkeleton class="size-10 shrink-0 rounded-full" />
            <div class="flex-1 space-y-2">
              <USkeleton class="h-4 w-40 rounded" />
              <USkeleton class="h-3 w-56 max-w-full rounded" />
            </div>
          </div>
        </div>
      </section>

      <div class="space-y-5">
        <section class="overflow-hidden rounded-xl border border-default bg-default">
          <div class="space-y-2 border-b border-default px-5 py-4">
            <USkeleton class="h-4 w-36 rounded" />
            <USkeleton class="h-3 w-44 rounded" />
          </div>
          <div class="grid grid-cols-7 gap-1 px-4 py-5">
            <USkeleton
              v-for="index in 7"
              :key="index"
              class="mx-auto h-12 w-8 rounded-lg"
            />
          </div>
        </section>
        <section class="space-y-3 rounded-xl border border-default bg-default p-5">
          <USkeleton class="h-4 w-28 rounded" />
          <USkeleton class="h-11 w-full rounded-lg" />
          <USkeleton class="h-11 w-full rounded-lg" />
        </section>
      </div>
    </div>
  </div>
</template>
