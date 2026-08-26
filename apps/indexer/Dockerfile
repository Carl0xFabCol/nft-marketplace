# Dockerfile for the Viem-based blockchain indexer
# Multi-stage build for production-optimized image

# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_STRICT=0
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml ./
COPY packages/config/tsconfig/package.json packages/config/tsconfig/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/

RUN pnpm install --frozen-lockfile

# ── Builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=deps /app/packages /app/packages

# Copy indexer source
COPY apps/indexer/ /app/apps/indexer/

# Build the indexer
FROM builder AS build
WORKDIR /app

RUN cd /app && pnpm --filter @marketplace/contracts build
RUN cd /app && pnpm --filter @marketplace/shared build
RUN cd /app && pnpm --filter @marketplace/database build
RUN cd /app && pnpm --filter @marketplace/indexer build

# ── Runner ────────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 3001 -S app && \
    adduser -u 3001 -S -G app -s /bin/sh app
USER app

# Copy built output + dependencies
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/apps/indexer/dist /app/apps/indexer/dist

# Expose no ports (indexer is a background worker)

# Health check (checks if process is running)
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const p = require('process'); process.exit(p.pid > 0 ? 0 : 1)"

# Start the indexer
CMD ["node", "apps/indexer/dist/index.js"]
