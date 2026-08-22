<script setup lang="ts">
const compose: { c?: string, k?: string, v?: string }[] = [
  { c: '# docker-compose.yml' },
  { k: 'services:' },
  { k: '  schedra:' },
  { k: '    build:', v: '.' },
  { k: '    ports:', v: '[\'3002:3000\']' },
  { k: '    environment:' },
  { k: '      DATABASE_URL:', v: 'postgres://schedra:schedra@db:5432/schedra' },
  { k: '      SCHEDRA_URL:', v: 'http://localhost:3002' },
  { c: '' },
  { k: '  db:' },
  { k: '    image:', v: 'postgres:18-alpine' }
]

const points = [
  ['Postgres and nothing else', 'No Redis, queue broker or object store. Bookings and durable email jobs live in the database you already back up.'],
  ['A real container build', 'The repository includes a multi-stage Dockerfile and a Compose setup that builds the app from source.'],
  ['No analytics beacon', 'The application does not ship a third-party analytics or advertising tracker. Licensing is being finalized before public launch.']
]
</script>

<template>
  <section
    id="developers"
    class="bg-muted"
  >
    <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-28">
      <div class="max-w-2xl">
        <p class="eyebrow text-dimmed">
          For developers
        </p>
        <h2 class="mt-6 font-editorial text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-highlighted">
          Or run the whole thing yourself.
        </h2>
        <p class="mt-6 text-[16px] leading-relaxed text-muted">
          Most people never need this part — skip it and just use your link. But
          The source is public, and if you would rather keep every booking on
          your own server, the repository includes the app and Postgres setup.
        </p>
      </div>

      <div class="mt-14 grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-14">
        <div class="overflow-hidden rounded-2xl border border-default bg-default shadow-sm">
          <div class="border-b border-default px-5 py-3">
            <span class="eyebrow text-dimmed">docker-compose.yml</span>
          </div>
          <pre class="overflow-x-auto px-5 py-5 font-mono text-[12px] leading-[1.8]"><code><template
            v-for="(line, i) in compose"
            :key="i"
          ><span
            v-if="line.c !== undefined"
            class="text-dimmed"
          >{{ line.c }}</span><template v-else><span class="text-toned">{{ line.k }}</span><span
            v-if="line.v"
            class="text-highlighted"
          > {{ line.v }}</span></template>
</template></code></pre>
        </div>

        <dl class="self-start divide-y divide-default border-y border-default">
          <div
            v-for="[title, body] in points"
            :key="title"
            class="py-6"
          >
            <dt class="text-[16px] font-semibold tracking-tight text-highlighted">
              {{ title }}
            </dt>
            <dd class="mt-2 text-[15px] leading-relaxed text-muted">
              {{ body }}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
