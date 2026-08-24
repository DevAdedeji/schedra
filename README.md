# Schedra

A source-available, self-hostable scheduling platform built around one app container and Postgres. A public-use license has not been selected yet.

> **Status: prelaunch.** Personal booking pages, race-safe booking, weekly
> availability, timezone conversion, host booking management, cancellation,
> rescheduling, meeting locations, calendar-file downloads, configurable
> reminders, durable email delivery and Google Calendar conflict/event/Meet sync
> are implemented. Teams, webhooks and embeds are not implemented yet. The
> homepage slot picker is an explicitly labelled interactive preview.

## Stack

Nuxt 4 · Nuxt UI 4 · Tailwind CSS v4 · TypeScript · Postgres · Drizzle

## Getting started

```bash
pnpm install
cp .env.example .env
docker compose up -d db   # Postgres on port 5442
pnpm db:migrate
pnpm dev
```

The dev server runs on `http://localhost:3002`.

```bash
pnpm build         # production build (the landing page is prerendered)
pnpm preview       # preview that build locally
pnpm lint          # eslint
pnpm typecheck     # vue-tsc
pnpm test          # vitest — database tests use TEST_DATABASE_URL only
pnpm test:e2e      # Playwright — complete host and guest booking lifecycle
pnpm db:generate   # generate a migration from schema changes
pnpm db:studio     # browse the database
```

Database tests are destructive by design and refuse to use the normal
`DATABASE_URL`. Put an isolated database whose name contains `test` in
`.env.test`:

```dotenv
TEST_DATABASE_URL=postgres://schedra:schedra@localhost:5442/schedra_test
```

## Deploying

Railway runs migrations as a pre-deploy command, so a failed migration aborts
the deploy before traffic moves. The Compose app service runs the same
migrations before starting the server.

Set these in the host's environment: `DATABASE_URL`, `SCHEDRA_URL`,
`AUTH_SECRET`, and optionally `DIRECT_URL`, `GOOGLE_*`,
`INTEGRATION_ENCRYPTION_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.

`SCHEDRA_URL` must match the public origin exactly. OAuth callbacks,
verification and reset links, booking links, canonical tags and `og:image` URLs
are all derived from it.

| Environment | `SCHEDRA_URL` |
|---|---|
| Production | `https://schedra.xyz` |
| Staging | `https://staging.schedra.xyz` |
| Local | `http://localhost:3002` |

Each needs its own Google authorised redirect URI, at
`${SCHEDRA_URL}/api/auth/callback/google` and
`${SCHEDRA_URL}/api/integrations/google-calendar/callback`. The Google Calendar
API must be enabled for the OAuth project before users connect calendars.

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
    BookingDemo.vue   Interactive slot picker in the hero
    SchedraMark.vue   Logo — `tile` (default) and `line` variants
  assets/css/main.css Design tokens: fonts, vermillion palette, grid rhythm
  pages/login.vue     Email/password and optional Google sign-in
  pages/signup.vue    Account creation and booking-link selection
  pages/[username]/   Public profile and booking pages
  pages/index.vue
server/
  domain/             Availability engine — pure, no I/O, no clock
  database/           Drizzle schema, migrations, client
  utils/auth.ts       Better Auth configuration and server-side profile checks
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

Near-monochrome with a single vermillion accent (`#FF3D00`), Instrument Serif
for editorial display type and Figtree for the interface. Fonts are downloaded
and self-hosted at build time, so the site makes no third-party font requests.

## License

None yet — default copyright applies until one is chosen.
