<script setup lang="ts">
import type { SeoLandingPageContent } from '~/data/seo-landing-pages'

const props = defineProps<{ page: SeoLandingPageContent }>()
const origin = useRuntimeConfig().public.siteUrl || useRequestURL().origin
const canonical = `${origin.replace(/\/$/, '')}${props.page.path}`
const { isSignedIn, accountDestination } = await useLandingNavigation()
const sectionName = props.page.path.startsWith('/features/') ? 'Features' : props.page.path.startsWith('/compare/') ? 'Compare' : 'Solutions'

useSeoMeta({
  title: props.page.metaTitle,
  description: props.page.metaDescription,
  ogTitle: props.page.metaTitle,
  ogDescription: props.page.metaDescription,
  ogUrl: canonical,
  twitterTitle: props.page.metaTitle,
  twitterDescription: props.page.metaDescription
})

useHead({
  link: [{ key: 'canonical', rel: 'canonical', href: canonical }],
  script: [{
    key: `structured-data-${props.page.path}`,
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': `${canonical}#webpage`,
          'url': canonical,
          'name': props.page.metaTitle,
          'description': props.page.metaDescription,
          'isPartOf': {
            '@type': 'WebSite',
            '@id': `${origin.replace(/\/$/, '')}/#website`,
            'name': 'Schedra',
            'url': origin
          }
        },
        {
          '@type': 'BreadcrumbList',
          'itemListElement': [
            { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': origin },
            { '@type': 'ListItem', 'position': 2, 'name': sectionName },
            { '@type': 'ListItem', 'position': 3, 'name': props.page.eyebrow, 'item': canonical }
          ]
        },
        {
          '@type': 'FAQPage',
          'mainEntity': props.page.faqs.map(item => ({
            '@type': 'Question',
            'name': item.question,
            'acceptedAnswer': { '@type': 'Answer', 'text': item.answer }
          }))
        }
      ]
    })
  }]
})
</script>

<template>
  <div class="bg-muted">
    <section class="border-b border-default">
      <div class="mx-auto max-w-312 px-6 pb-20 pt-8 lg:px-10 lg:pb-28 lg:pt-10">
        <nav
          aria-label="Breadcrumb"
          class="flex flex-wrap items-center gap-2 text-[14px] text-dimmed"
        >
          <NuxtLink
            to="/"
            class="transition-colors hover:text-highlighted"
          >Home</NuxtLink>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-3.5"
          />
          <span>{{ sectionName }}</span>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-3.5"
          />
          <span class="text-toned">{{ page.eyebrow }}</span>
        </nav>

        <div class="mt-14 grid items-end gap-12 lg:grid-cols-[1.25fr_0.75fr] lg:gap-20">
          <div>
            <p class="eyebrow text-primary">
              {{ page.eyebrow }}
            </p>
            <h1 class="mt-6 max-w-[18ch] font-editorial text-[clamp(3rem,7vw,5.75rem)] font-normal leading-[0.96] tracking-[-0.025em] text-highlighted">
              {{ page.headline }}
            </h1>
            <p class="mt-7 max-w-[58ch] text-[18px] leading-[1.7] text-toned">
              {{ page.intro }}
            </p>
            <div class="mt-9 flex flex-wrap gap-3">
              <UButton
                :to="accountDestination"
                size="xl"
                class="rounded-full px-7 font-medium"
              >
                {{ isSignedIn ? 'Go to dashboard' : 'Create your booking page' }}
              </UButton>
              <UButton
                to="/features"
                size="xl"
                color="neutral"
                variant="outline"
                class="rounded-full px-7 font-medium"
              >
                Explore features
              </UButton>
            </div>
          </div>

          <aside class="rounded-2xl border border-default bg-default p-6 sm:p-8">
            <p class="eyebrow text-dimmed">
              Built for
            </p>
            <ul class="mt-5 divide-y divide-default">
              <li
                v-for="useCase in page.useCases"
                :key="useCase"
                class="flex items-center gap-3 py-3.5 text-[16px] font-medium text-highlighted"
              >
                <UIcon
                  name="i-lucide-circle-check"
                  class="size-4 shrink-0 text-primary"
                />
                {{ useCase }}
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </section>

    <section class="border-b border-default bg-default">
      <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-24">
        <div class="max-w-3xl">
          <p class="eyebrow text-primary">
            Why Schedra
          </p>
          <h2 class="mt-5 font-editorial text-[clamp(2.35rem,5vw,4rem)] leading-[1.02] tracking-[-0.02em] text-highlighted">
            {{ page.problemTitle }}
          </h2>
          <p class="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-muted">
            {{ page.problemDescription }}
          </p>
        </div>

        <div class="mt-12 grid gap-px overflow-hidden rounded-2xl border border-default bg-default md:grid-cols-3">
          <article
            v-for="benefit in page.benefits"
            :key="benefit.title"
            class="surface-secondary p-7 lg:p-8"
          >
            <span class="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UIcon
                :name="benefit.icon"
                class="size-5"
              />
            </span>
            <h3 class="mt-8 text-[18px] font-semibold tracking-tight text-highlighted">
              {{ benefit.title }}
            </h3>
            <p class="mt-3 text-[15px] leading-relaxed text-muted">
              {{ benefit.description }}
            </p>
          </article>
        </div>
      </div>
    </section>

    <section class="border-b border-default">
      <div class="mx-auto grid max-w-312 gap-12 px-6 py-20 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20 lg:px-10 lg:py-24">
        <div>
          <p class="eyebrow text-dimmed">
            How it works
          </p>
          <h2 class="mt-5 max-w-[14ch] font-editorial text-[clamp(2.35rem,5vw,3.75rem)] leading-[1.03] tracking-[-0.02em] text-highlighted">
            A clear path from setup to booked.
          </h2>
        </div>

        <ol class="divide-y divide-default border-y border-default">
          <li
            v-for="(step, index) in page.steps"
            :key="step.title"
            class="grid gap-3 py-7 sm:grid-cols-[3rem_12rem_1fr] sm:gap-6"
          >
            <span class="tnum text-[14px] font-semibold text-primary">0{{ index + 1 }}</span>
            <h3 class="text-[17px] font-semibold text-highlighted">
              {{ step.title }}
            </h3>
            <p class="text-[15px] leading-relaxed text-muted">
              {{ step.description }}
            </p>
          </li>
        </ol>
      </div>
    </section>

    <section class="border-b border-default bg-default">
      <div class="mx-auto grid max-w-312 gap-12 px-6 py-20 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20 lg:px-10 lg:py-24">
        <div>
          <p class="eyebrow text-primary">
            Questions, answered
          </p>
          <h2 class="mt-5 font-editorial text-[clamp(2.35rem,5vw,3.75rem)] leading-[1.03] tracking-[-0.02em] text-highlighted">
            The details that matter.
          </h2>
        </div>

        <div class="divide-y divide-default border-y border-default">
          <details
            v-for="(faq, index) in page.faqs"
            :key="faq.question"
            :open="index === 0"
            class="group py-6"
          >
            <summary class="flex cursor-pointer list-none items-start justify-between gap-6 text-[17px] font-semibold text-highlighted">
              {{ faq.question }}
              <UIcon
                name="i-lucide-plus"
                class="mt-0.5 size-5 shrink-0 text-primary transition-transform group-open:rotate-45"
              />
            </summary>
            <p class="mt-4 max-w-[68ch] pr-10 text-[15px] leading-relaxed text-muted">
              {{ faq.answer }}
            </p>
          </details>
        </div>
      </div>
    </section>

    <section>
      <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-24">
        <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p class="eyebrow text-dimmed">
              Keep exploring
            </p>
            <h2 class="mt-4 font-editorial text-[clamp(2.2rem,4vw,3.25rem)] leading-none text-highlighted">
              Find the scheduling flow that fits.
            </h2>
          </div>
          <UButton
            to="/pricing"
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-arrow-right"
            class="self-start rounded-full font-medium sm:self-auto"
          >
            Compare plans
          </UButton>
        </div>

        <div class="mt-10 grid gap-4 md:grid-cols-3">
          <NuxtLink
            v-for="item in page.related"
            :key="item.to"
            :to="item.to"
            class="group rounded-2xl border border-default bg-default p-6 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
          >
            <div class="flex items-start justify-between gap-4">
              <h3 class="text-[17px] font-semibold text-highlighted">
                {{ item.label }}
              </h3>
              <UIcon
                name="i-lucide-arrow-up-right"
                class="size-4 shrink-0 text-dimmed transition group-hover:text-primary"
              />
            </div>
            <p class="mt-3 text-[15px] leading-relaxed text-muted">
              {{ item.description }}
            </p>
          </NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>
