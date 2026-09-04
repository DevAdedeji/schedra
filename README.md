# Schedra

Schedra is a full-stack scheduling application built as a portfolio project:
shareable booking pages, personal and team availability, calendar integrations,
video meetings, recurring bookings, and payment-aware booking workflows.

[Application](https://schedra.xyz) · [Features](https://schedra.xyz/features) ·
[Security reporting](SECURITY.md)

The source is available for viewing and evaluation under the proprietary
[LICENSE](LICENSE); public visibility does not make it open source. This is an
actively maintained demonstration, not a claim of production certification or
customer adoption. Payment mode is shown in the app when sandbox is configured.

## Explore the product

Use an account and email address you control. Create an event type, choose your
hours, and open the booking link in a separate browser session. Make a test
booking, then reschedule or cancel it to see the full lifecycle. Invite a second
test account to explore team roles and round-robin or collective scheduling.

Sandbox checkout does not move real money, but emails, calendar invitations,
and video meetings can still be real. Use dedicated test calendars and only
Bachs-provided test payment details. Never enter someone else's personal data.

## Implemented capabilities

- Personal booking pages, multiple durations, recurring meetings, group capacity,
  booking questions, approvals, single-use links, and website overlays.
- Time-zone-aware schedules, date overrides, away periods, buffers, notice,
  booking windows, and daily/weekly/monthly limits.
- Google and Microsoft Calendar, iCloud CalDAV, Google Meet, Microsoft Teams,
  and Zoom, with connection-health and retry handling.
- Team roles, round-robin/collective assignment, managed event templates,
  personal/team branding, and customizable guest emails.
- Email/webhook workflows, routing forms, analytics, attendance tracking,
  notification preferences, and authenticator-based two-factor authentication.
- Bachs subscription and paid-booking flows, payment holds, refunds, ledger
  records, reconciliation, and private operational controls.

## Engineering decisions

| Concern | Implementation and reason |
|---|---|
| Availability | A pure TypeScript engine using Temporal handles time zones and daylight-saving changes; database constraints protect reservations when requests race. |
| Durable work | PostgreSQL-backed queues hold email, workflow, and calendar jobs so a request can finish without waiting for a provider. Workers claim, retry, and expose failed work. |
| Payments | Server-side provider verification, idempotent operations, payment holds, and reconciliation distinguish a checkout redirect from confirmed money. |
| Access | Better Auth handles authentication and 2FA; server-side checks enforce personal/team ownership and a separate administrator allowlist. |
| Structure | `server/domain` owns pure rules; `services` orchestrate workflows; `repositories` and `database` own persistence; frontend composables/components are grouped by feature. |

Provider tests use controlled fakes; passing them does not prove a deployed
calendar account or payment provider is configured correctly. Sandbox acceptance
and restore drills remain part of release verification.

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

For a portfolio deployment on the production domain, keep
`SCHEDRA_ENVIRONMENT=production` and explicitly set `SCHEDRA_BILLING_MODE=sandbox`
with matching sandbox `BACHS_SECRET_KEY` and `BACHS_WEBHOOK_SECRET` values.
Register the sandbox webhook at `/api/webhooks/bachs` on that deployment's HTTPS
origin. Do not weaken application security by calling the deployment staging.

The explicit mode rejects mismatched live credentials. It does not cancel or
convert existing live subscriptions, remove payment records, or disable real
email/calendar actions. Do not reuse a database containing live financial
history for sandbox experimentation; use a separate demo environment instead.
Never commit provider keys. See [the public-release checklist](docs/PUBLIC_RELEASE.md).

Run `pnpm db:migrate` before starting the new application version. The current
release candidate includes four ordered migrations that must not be skipped:

- `0050_complete_lady_deathstrike.sql` adds managed-event assignments and the
  list of template fields that a team member may personalize.
- `0051_bumpy_rage.sql` adds email-notification preferences, authenticator 2FA
  records and booking attendance/no-show fields.
- `0052_cool_bruce_banner.sql` stores paid personal/team guest-email templates
  and snapshots the selected branding into queued email jobs.
- `0053_booking_buffer_reservations.sql` snapshots protected meeting buffers and
  enforces them across every host reservation. Run the count-only conflict
  preflight in [the migration guide](docs/BOOKING_BUFFER_MIGRATION.md) first;
  existing conflicting buffers deliberately block deployment without moving guests.

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

Copyright © 2026 Schedra. All rights reserved. This project is proprietary;
access to its source code does not grant permission to copy, modify,
distribute or operate the software. See [LICENSE](LICENSE).
