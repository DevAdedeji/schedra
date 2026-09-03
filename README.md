# Schedra

Schedra is a scheduling platform for personal and team bookings. It supports
shareable booking pages, availability management, calendar integrations,
video-meeting links, team workspaces and website booking overlays.

> Schedra is under active development. This repository is publicly visible for
> transparency and evaluation, but it is not open source. See [LICENSE](LICENSE).

## Technology

Nuxt 4 · TypeScript · PostgreSQL · Drizzle ORM · Nuxt UI · Tailwind CSS

## Local development

Requirements: Node.js 22+, pnpm and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d db
pnpm db:migrate
pnpm dev
```

The application runs at `http://localhost:3002` by default. The values required
for local development are documented in `.env.example`.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Database and browser tests require an isolated test database configured with
`TEST_DATABASE_URL` in `.env.test`. Test commands may erase that database.

Production builds require `SCHEDRA_URL` during the build as well as at runtime.
The build fails if prerendered marketing pages contain the wrong canonical URL
or indexing directive. For Docker builds, pass it as a build argument, for
example `--build-arg SCHEDRA_URL=https://schedra.xyz`.

## Production deployment

Run `pnpm db:migrate` before starting the new application version. The current
release candidate includes two ordered migrations that must not be skipped:

- `0050_complete_lady_deathstrike.sql` adds managed-event assignments and the
  list of template fields that a team member may personalize.
- `0051_bumpy_rage.sql` adds email-notification preferences, authenticator 2FA
  records and booking attendance/no-show fields.

Background work must be running in every deployed environment. For a small
deployment, use `SCHEDRA_PROCESS_ROLE=all` on the application process. For
separate services, run the web service with `SCHEDRA_PROCESS_ROLE=web` and run
`node scripts/start-worker.mjs` from the same built image as a continuously
running worker (`pnpm worker` is the equivalent source-checkout command). The
worker delivers queued email and workflows, synchronizes and periodically
reconciles calendars, expires payment holds, recovers stale refunds, reconciles
team seats and evaluates operational alerts. Without it, HTTP pages may still
load while those durable jobs remain pending.

After deployment, verify that migrations completed, `/api/healthz` responds,
`/api/readyz` reports ready for the process role, and the private Operations page
shows an online worker with no unexpected failed or stale jobs. Exercise a normal
booking, reschedule and cancellation in staging before promoting the release.
Provider-dependent release checks must use sandbox or dedicated staging accounts:
confirm an Apple Calendar event can be created, updated and removed, and confirm
the Bachs refund state moves from pending to its provider-confirmed result. The
automated suite covers these boundaries with fakes, but it does not replace live
iCloud or Bachs validation.

## Apple Calendar

Apple Calendar connects through iCloud CalDAV. Users must enable two-factor
authentication on their Apple Account and create an app-specific password at
`account.apple.com` under **Sign-In and Security → App-Specific Passwords**.
Schedra encrypts that password using `INTEGRATION_ENCRYPTION_KEY`; the normal
Apple Account password must never be entered. Changing the main Apple Account
password revokes app-specific passwords, so the integration will then show
**Needs attention** until it is reconnected with a new one.

No Apple-specific deployment secret or callback URL is required. Production
must be able to make outbound HTTPS requests to `*.icloud.com`.

The CalDAV implementation and failure handling have automated provider-boundary
coverage. A real iCloud account should still complete the staging create,
reschedule and cancellation check described above before launch.

## Security

Please do not disclose vulnerabilities in public issues. Follow the private
reporting instructions in [SECURITY.md](SECURITY.md).

## License

Copyright © 2026 Schedra. All rights reserved. This project is proprietary and
source-available; viewing the repository does not grant permission to copy,
modify, distribute or operate the software. See [LICENSE](LICENSE).
