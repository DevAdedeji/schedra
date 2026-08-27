# Schedra

A proprietary scheduling platform for personal and team bookings, built with Nuxt and Postgres.

> **Status: prelaunch.** Personal booking pages, race-safe booking, weekly
> availability, timezone conversion, host booking management, cancellation,
> rescheduling, additional guests, host approval, custom guest questions,
> meeting locations, calendar-file downloads, configurable reminders, durable
> SMTP/Resend email delivery and Google Calendar conflict/event/Meet sync
> are implemented. Team workspaces, shared event types, invitations and
> cross-site booking embeds, durable provider webhooks and a private operations
> dashboard are implemented. The homepage slot picker is an explicitly
> labelled interactive preview.

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
pnpm worker        # start the built bundle as a worker-only process
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

Schedra has a PostgreSQL-backed job runtime for calendar updates, email,
subscription seat reconciliation, billing reminders and operational alerts.
`SCHEDRA_PROCESS_ROLE=all` is the safe default for development and a single
service: database leases prevent duplicate scheduled work even when several
instances overlap during a deploy.

For independent production scaling, deploy the same image twice:

| Service | Start command | Environment |
|---|---|---|
| Web | `node .output/server/index.mjs` | `SCHEDRA_PROCESS_ROLE=web` |
| Worker | `node scripts/start-worker.mjs` | role is set to `worker` by the script |

Do not expose the worker service publicly. It serves only `/api/healthz` and
`/api/readyz`; all other routes return 404. Use `/api/readyz` for deployment
health checks. During shutdown it stops claiming work, drains active tasks and
releases its database leases. Jobs interrupted by a hard termination are
reclaimed from their durable queue after their lock expires.

Set these in the host's environment: `DATABASE_URL`, `SCHEDRA_URL`,
`AUTH_SECRET`, and optionally `DIRECT_URL`, `GOOGLE_*`,
`INTEGRATION_ENCRYPTION_KEY`, `SMTP_URL` or `RESEND_API_KEY`, and `EMAIL_FROM`.

`SMTP_URL` takes precedence when both email transports are configured. Staging
and production require one transport plus an authorized `EMAIL_FROM`; local
development logs skipped delivery when neither transport is set.

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

## Embedding a booking page

Open **Event types**, choose **Embed on website** for an active personal event,
or use the same action from a team's event-type menu. The generator provides a
responsive snippet, theme and accent controls, optional visitor prefilling, and
a live preview.

The standard button installation is plain HTML:

```html
<button
  type="button"
  data-schedra-embed="https://schedra.xyz/your-name/consultation"
  data-schedra-theme="auto"
  data-schedra-accent="#FF3D00"
>
  Book a meeting
</button>
<script async src="https://schedra.xyz/embed.js"></script>
```

Use a team URL such as `https://schedra.xyz/team/acme/consultation` in the same
attribute for a shared event type. The loader also supports an existing button
or a floating launcher. The generated script must come from the same Schedra
origin as the booking URL, so staging snippets load the staging script.

Optional `data-schedra-name` and `data-schedra-email` attributes prefill the
guest form. Only use them when the visitor has already shared that information
with the host website. Schedra forwards the referring hostname and any `utm_*`
parameters into booking attribution, but parent-page completion events do not
contain visitor identity.

For application code, `window.SchedraEmbed.open({ bookingUrl })` opens the
overlay and `window.SchedraEmbed.close()` closes it. The loader dispatches
`schedra:open`, `schedra:ready`, `schedra:booking-completed`, `schedra:close`
and `schedra:error` events on `window`.

Only public booking routes can be framed. Account and dashboard routes retain
their deny-framing security policy.

**Neon** hands out two connection strings. Point `DATABASE_URL` at the pooled
host (it contains `-pooler`) and `DIRECT_URL` at the direct one. Migrations use
the direct endpoint because DDL through PgBouncer is unreliable, and the app
disables prepared statements automatically when it detects a pooled host.

`GET /api/healthz` is a process-only liveness check. `GET /api/readyz` checks
Postgres and required safety migrations; on a worker-only service it also
requires a fresh worker heartbeat. The public response stays deliberately
generic, while detailed health is available to platform administrators at
`/operations`.

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
  repositories/       Database access grouped by domain
  services/           Application workflows and external integrations
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
and bundled locally at build time, so the site makes no third-party font requests.

## License

Proprietary. See `LICENSE`.
