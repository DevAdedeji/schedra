<script setup lang="ts">
const claims = [
  'Own your data',
  'Postgres only',
  'No Redis',
  'DST-safe engine',
  'One container',
  'Zero telemetry'
]
</script>

<template>
  <GridSection
    :rules="false"
    muted
  >
    <ul class="-mx-5 grid grid-cols-2 gap-px bg-border sm:-mx-6 sm:grid-cols-3 md:mr-[-3rem] md:ml-[-3rem] lg:grid-cols-6">
      <li
        v-for="claim in claims"
        :key="claim"
        class="bg-muted px-4 py-4 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted"
      >
        {{ claim }}
      </li>
    </ul>
  </GridSection>
</template>
