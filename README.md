# Schedra

An open-source, self-hostable scheduling platform. One container, one Postgres, no vendor in the middle.

> **Status: early.** The landing page, the availability engine and the database
> schema exist. There is no authentication, no calendar sync and no booking API
> yet, so nothing is wired end to end. The slot picker on the homepage is a demo
> backed by generated availability, not real data.

## Stack

Nuxt 4 · Nuxt UI 4 · Tailwind CSS v4 · TypeScript · Postgres · Drizzle

## Getting started

```bash
pnpm install
cp .env.example .env
docker compose up -d   # Postgres on port 5442
pnpm db:migrate
pnpm dev
```

The dev server runs on `http://localhost:3000`.

```bash
pnpm build         # production build (the landing page is prerendered)
pnpm preview       # preview that build locally
pnpm lint          # eslint
pnpm typecheck     # vue-tsc
pnpm test          # vitest — skips database tests if DATABASE_URL is unset
pnpm db:generate   # generate a migration from schema changes
pnpm db:studio     # browse the database
```

## Deploying

Migrations do **not** run automatically at boot. `railway.toml` sets them as a
pre-deploy command, so a failed migration aborts the deploy rather than
crashlooping the running version.

Set these in the host's environment: `DATABASE_URL`, `SCHEDRA_URL`,
`AUTH_SECRET`, and optionally `DIRECT_URL`, `GOOGLE_*`, `RESEND_API_KEY`,
`EMAIL_FROM`.

`SCHEDRA_URL` must match the public origin exactly — OAuth callbacks,
verification and reset links are all built from it.

**Neon** hands out two connection strings. Point `DATABASE_URL` at the pooled
host (it contains `-pooler`) and `DIRECT_URL` at the direct one. Migrations use
the direct endpoint because DDL through PgBouncer is unreliable, and the app
disables prepared statements automatically when it detects a pooled host.

`GET /api/healthz` returns 503 if the double-booking constraint is missing,
which is the failure mode worth alerting on — the app would otherwise serve
traffic happily while accepting overlapping bookings.

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
server/
  domain/             Availability engine — pure, no I/O, no clock
  database/           Drizzle schema, migrations, client
```

Overlapping bookings are prevented by a Postgres `EXCLUDE USING gist`
constraint, not by application code — a check-then-insert loses the race when
two people confirm the same slot at once. See
`server/database/migrations/0001_booking_overlap_constraint.sql`.

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
