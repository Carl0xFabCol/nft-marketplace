# Dockerfile for the Next.js web app
# Multi-stage build for production-optimized image

# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
# Enable Corepack for pnpm
ENV COREPACK_ENABLE_STRICT=0
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Install dependencies (leveraging Docker cache)
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

# Copy lockfile + package.json + node_modules from deps layer
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=deps /app/packages /app/packages

# Copy web app source
COPY apps/web/ /app/apps/web/

# Build
FROM builder AS build
WORKDIR /app/apps/web

# Build shared dependencies first (monorepo cache)
RUN cd /app && pnpm --filter @marketplace/contracts build
RUN cd /app && pnpm --filter @marketplace/shared build
RUN cd /app && pnpm --filter @marketplace/database build

# Build web app
RUN cd /app && pnpm --filter @marketplace/web build

# ── Runner ────────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 3001 -S app && \
    adduser -u 3001 -S -G app -s /bin/sh app
USER app

# Copy built output
FROM runner
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:3000/_next/static/chunks/ || exit 1

# Start the app
CMD ["node", "apps/web/server.js"]
