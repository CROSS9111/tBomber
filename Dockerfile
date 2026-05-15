# syntax=docker/dockerfile:1.7
# 統合サーバー (Next.js + Colyseus) 用 Dockerfile
# multi-stage build で本番イメージは tsx + .next/ + node_modules の最小構成に保つ

ARG NODE_VERSION=20-alpine

# ===== deps: 依存関係を別レイヤで =====
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ===== builder: ソースを置いて next build =====
FROM node:${NODE_VERSION} AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web ./apps/web
ENV NODE_ENV=production
RUN pnpm --filter web build

# ===== runner: 本番起動 =====
FROM node:${NODE_VERSION} AS runner
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate \
    && addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /repo/node_modules ./node_modules
COPY --from=builder --chown=app:app /repo/apps/web ./apps/web
COPY --chown=app:app pnpm-workspace.yaml package.json pnpm-lock.yaml ./
USER app
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
