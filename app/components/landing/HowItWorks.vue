<script setup lang="ts">
const steps = [
  {
    title: 'Say when you\'re free',
    body: 'Set your usual hours once. Different times on different days is fine, and a holiday is two clicks.'
  },
  {
    title: 'Share your link',
    body: 'A page of your own. Drop it in your signature, your bio, or send it to one person.'
  },
  {
    title: 'You\'re booked',
    body: 'They pick a time. It lands in both calendars, and you both get a reminder.'
  }
]
</script>

<template>
  <section
    id="how"
    class="border-y border-default bg-default"
  >
    <div class="mx-auto max-w-[78rem] px-6 py-20 lg:px-10 lg:py-28">
      <p class="eyebrow text-dimmed">
        How it works
      </p>
      <h2 class="mt-6 max-w-[16ch] font-editorial text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.05] tracking-[-0.02em] text-highlighted">
        Three steps, then forget about it.
      </h2>

      <ol class="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
        <li
          v-for="(step, index) in steps"
          :key="step.title"
        >
          <span class="font-editorial text-[3rem] leading-none text-primary">
            {{ index + 1 }}
          </span>
          <h3 class="mt-5 text-[19px] font-semibold tracking-tight text-highlighted">
            {{ step.title }}
          </h3>
          <p class="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-muted">
            {{ step.body }}
          </p>
        </li>
      </ol>
    </div>
  </section>
</template>
