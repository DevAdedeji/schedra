<script setup lang="ts">
defineProps<{
  eyebrow: string
  title: string
  summary: string
  updated?: string
}>()
</script>

<template>
  <div>
    <section class="border-b border-default">
      <div class="mx-auto max-w-312 px-6 py-16 lg:px-10 lg:py-24">
        <p class="eyebrow text-dimmed">
          {{ eyebrow }}
        </p>
        <h1 class="mt-5 max-w-[20ch] font-editorial text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02] tracking-[-0.02em] text-highlighted">
          {{ title }}
        </h1>
        <p class="mt-6 max-w-[62ch] text-[17px] leading-relaxed text-muted">
          {{ summary }}
        </p>
        <p
          v-if="updated"
          class="mt-5 text-[13px] text-dimmed"
        >
          Last updated {{ updated }}
        </p>
      </div>
    </section>

    <section class="bg-muted">
      <article class="public-document mx-auto max-w-220 px-6 py-14 lg:px-10 lg:py-20">
        <slot />
      </article>
    </section>
  </div>
</template>

<style scoped>
.public-document :deep(section + section) {
  margin-top: 3rem;
  padding-top: 3rem;
  border-top: 1px solid var(--ui-border);
}

.public-document :deep(h2) {
  color: var(--ui-text-highlighted);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.public-document :deep(h3) {
  margin-top: 1.75rem;
  color: var(--ui-text-highlighted);
  font-size: 0.9375rem;
  font-weight: 600;
}

.public-document :deep(p),
.public-document :deep(li) {
  color: var(--ui-text-muted);
  font-size: 0.9375rem;
  line-height: 1.75;
}

.public-document :deep(h2 + p),
.public-document :deep(h2 + ul),
.public-document :deep(h2 + ol),
.public-document :deep(h3 + p),
.public-document :deep(h3 + ul),
.public-document :deep(p + p),
.public-document :deep(p + ul),
.public-document :deep(p + ol),
.public-document :deep(ul + p),
.public-document :deep(ol + p) {
  margin-top: 1rem;
}

.public-document :deep(ul),
.public-document :deep(ol) {
  display: grid;
  gap: 0.625rem;
  padding-left: 1.25rem;
}

.public-document :deep(ul) {
  list-style: disc;
}

.public-document :deep(ol) {
  list-style: decimal;
}

.public-document :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
}

.public-document :deep(strong) {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.public-document :deep(code) {
  border-radius: 0.35rem;
  background: var(--ui-bg-elevated);
  padding: 0.12rem 0.35rem;
  color: var(--ui-text-highlighted);
  font-size: 0.84em;
}

.public-document :deep(.callout) {
  margin-top: 1.5rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  background: var(--ui-bg);
  padding: 1.25rem;
}
</style>
