# Server architecture

Schedra's server code follows a one-way dependency flow:

```text
API routes / plugins
        ↓
services (business workflows and transaction boundaries)
        ↓
repositories (reusable persistence queries)
        ↓
database (schema, connection, migrations)

services → integrations (Google, email, billing)
services → domain (pure scheduling rules)
```

## Directory responsibilities

- `api/`: HTTP parsing, authentication/authorization entry points, status codes, and response shapes.
- `services/`: business policy and workflow orchestration. A service may own a database transaction when several writes must succeed atomically.
- `repositories/`: reusable persistence reads and writes. Database-backed policy lookups belong here rather than in a utility.
- `database/`: Drizzle schema, connection lifecycle, migrations, and database integration tests.
- `domain/`: deterministic business rules with no framework, network, or database dependency.
- `integrations/`: external provider adapters and credential handling.
- `security/`: request and security policy helpers.
- `config/`: validated runtime configuration.
- `plugins/job-runtime.ts`: starts the consolidated durable worker when the process role is `worker` or `all`.
- `services/worker-coordination.ts`: database leases, worker heartbeats and crash-safe ownership for scheduled tasks.
- `utils/`: small, deterministic helpers only. Utilities must not query the database or call external services.

ESLint enforces the pure-layer boundary for `server/utils`, `server/domain`, and `shared`. It rejects imports from Drizzle, Postgres, the database layer, or repositories in those directories.
