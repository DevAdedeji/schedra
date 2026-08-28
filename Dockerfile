# pnpm is installed directly rather than through corepack: the corepack bundled
# with Node images is too old to launch pnpm 11 and fails with
# ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING.
FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@11.20.0

# Production dependencies only, kept apart so the runtime image does not carry
# the build toolchain. Scripts are skipped because the postinstall hook runs
# `nuxt prepare`, which needs devDependencies that are deliberately absent here.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Bind all interfaces so the container is reachable. The port is deliberately
# not pinned: Nitro reads PORT at runtime and hosts like Railway assign it,
# while NITRO_PORT would take precedence and override them.
ENV NITRO_HOST=0.0.0.0

COPY --from=builder /app/.output ./.output

# The migration step runs outside the Nitro bundle, so it needs drizzle-orm and
# postgres on disk plus the .sql files the migrator reads at run time.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/server/database/migrations ./server/database/migrations

# Documentation only — the real port comes from PORT at runtime.
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
