<script setup lang="ts">
/** Rendered as explicit key/value parts so the block stays two-tone and
 *  monochrome — syntax rainbow would fight the rest of the page. */
const compose: { c?: string, k?: string, v?: string }[] = [
  { c: '# docker-compose.yml — the entire deployment' },
  { k: 'services:' },
  { k: '  schedra:' },
  { k: '    image:', v: 'ghcr.io/schedra/schedra:latest' },
  { k: '    ports:', v: '[\'3000:3000\']' },
  { k: '    environment:' },
  { k: '      DATABASE_URL:', v: 'postgres://schedra@db:5432/schedra' },
  { k: '      SCHEDRA_URL:', v: 'https://cal.yourdomain.com' },
  { k: '      SMTP_URL:', v: 'smtp://user:pass@mail.yourdomain.com:587' },
  { k: '      AUTH_SECRET:', v: '${AUTH_SECRET}' },
  { k: '    depends_on:', v: '[db]' },
  { c: '' },
  { k: '  db:' },
  { k: '    image:', v: 'postgres:17-alpine' },
  { k: '    volumes:', v: '[\'schedra-data:/var/lib/postgresql/data\']' }
]

const boot = [
  { ok: false, text: '$ docker compose up -d' },
  { ok: true, text: 'postgres    healthy', meta: '0.9s' },
  { ok: true, text: 'schedra     migrated', meta: '1.4s' },
  { ok: true, text: 'ready       http://localhost:3000', meta: '' }
]

const points = [
  {
    icon: 'i-lucide-database',
    title: 'Postgres and nothing else',
    body: 'No Redis, no queue broker, no object store. Jobs and scheduling live in the database you already back up.'
  },
  {
    icon: 'i-lucide-shield-check',
    title: 'Your data stays yours',
    body: 'OAuth tokens encrypted at rest on your disk. No phone-home, no analytics beacon, no vendor in the middle.'
  },
  {
    icon: 'i-lucide-git-branch',
    title: 'Fork it if you want',
    body: 'MIT licensed, top to bottom. No enterprise tier gating teams, SSO or the API behind a second repository.'
  }
]
</script>

<template>
  <GridSection
    id="self-host"
    :rail="['04', '05', '06', '07', '08', '09']"
  >
    <div class="py-16 lg:py-24">
      <header class="max-w-2xl">
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-dimmed">
          Self-hosting
        </p>
        <h2 class="mt-5 text-[clamp(1.9rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-highlighted">
          Up in one command.
        </h2>
        <p class="mt-5 text-[15px] leading-relaxed text-muted">
          Self-hosting is the product, not an afterthought bolted onto a SaaS.
          Two services, ten environment variables, migrations that run
          themselves on boot.
        </p>
      </header>

      <div class="mt-12 grid gap-px border border-default bg-border lg:grid-cols-[1.35fr_1fr]">
        <div class="bg-default">
          <div class="border-b border-default px-4 py-2.5">
            <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
              docker-compose.yml
            </span>
          </div>
          <pre class="overflow-x-auto px-4 py-4 font-mono text-[11.5px] leading-[1.75]"><code><template
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

        <div class="bg-default">
          <div class="border-b border-default px-4 py-2.5">
            <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
              Boot
            </span>
          </div>
          <div class="space-y-2 px-4 py-4 font-mono text-[11.5px]">
            <div
              v-for="line in boot"
              :key="line.text"
              class="flex items-center gap-2"
            >
              <UIcon
                v-if="line.ok"
                name="i-lucide-check"
                class="size-3.5 shrink-0 text-primary"
              />
              <span
                v-else
                class="w-3.5 shrink-0"
              />
              <span :class="line.ok ? 'text-toned' : 'text-highlighted'">{{ line.text }}</span>
              <span
                v-if="line.meta"
                class="tnum ml-auto text-dimmed"
              >{{ line.meta }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-px grid gap-px border-x border-b border-default bg-border sm:grid-cols-3">
        <div
          v-for="point in points"
          :key="point.title"
          class="bg-default p-6"
        >
          <UIcon
            :name="point.icon"
            class="size-5 text-primary"
          />
          <h3 class="mt-8 text-[15px] font-semibold tracking-tight text-highlighted">
            {{ point.title }}
          </h3>
          <p class="mt-2 text-[13px] leading-relaxed text-muted">
            {{ point.body }}
          </p>
        </div>
      </div>
    </div>
  </GridSection>
</template>
