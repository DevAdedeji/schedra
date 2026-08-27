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

## Security

Please do not disclose vulnerabilities in public issues. Follow the private
reporting instructions in [SECURITY.md](SECURITY.md).

## License

Copyright © 2026 Schedra. All rights reserved. This project is proprietary and
source-available; viewing the repository does not grant permission to copy,
modify, distribute or operate the software. See [LICENSE](LICENSE).
