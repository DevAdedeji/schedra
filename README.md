# Schedra

An open-source, self-hostable scheduling platform. One container, one Postgres, no vendor in the middle.

> **Status: early.** Only the marketing landing page exists today — there is no
> booking engine, no database and no authentication yet. The slot picker on the
> homepage is a working demo backed by generated availability, not real data.

## Stack

Nuxt 4 · Nuxt UI 4 · Tailwind CSS v4 · TypeScript

## Getting started

```bash
pnpm install
pnpm dev
```

The dev server runs on `http://localhost:3000`.

```bash
pnpm build      # production build (the landing page is prerendered)
pnpm preview    # preview that build locally
pnpm lint       # eslint
pnpm typecheck  # vue-tsc
```

## Layout

```
app/
  components/
    landing/          Landing page sections
    GridSection.vue   The calendar grid every section is drawn on
    BookingDemo.vue   Interactive slot picker in the hero
    SchedraMark.vue   Logo — `tile` (default) and `line` variants
  assets/css/main.css Design tokens: fonts, vermillion palette, grid rhythm
  pages/index.vue
```

Two custom properties in `main.css` drive the whole layout: `--row` sets the
horizontal rule rhythm and `--rail` the width of the hour gutter. The hour
labels and the rules are laid out against the same values, so they stay aligned
no matter how content reflows.

## Design

Near-monochrome with a single vermillion accent (`#FF3D00`), Inter Tight for
display and JetBrains Mono for anything showing a time. Fonts are downloaded and
self-hosted at build time, so the site makes no third-party requests.

## License

None yet — default copyright applies until one is chosen.
