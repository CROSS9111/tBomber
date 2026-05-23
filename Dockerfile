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
RUN pnpm --filter web build \
    # ビルドキャッシュは本番イメージに不要なので除去 (数百MB削減)
    && rm -rf apps/web/.next/cache

# ===== prod-deps: 本番依存のみを別レイヤで解決 (devDeps を含めない) =====
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
# --prod で dependencies のみ / --ignore-scripts で husky(prepare) 等を無効化
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts
# 本番ランタイムに不要なパッケージを除去:
#  - @next/swc-* : SWC コンパイラはビルド時専用。next start では未使用 (~244MB)
#  - phaser / phaser3-rex-plugins : クライアント専用 (CDN/ビルド済み static に同梱)。
#    サーバーコードは import していない (~126MB)
RUN rm -rf node_modules/.pnpm/@next+swc-* \
           node_modules/.pnpm/phaser@* \
           node_modules/.pnpm/phaser3-rex-plugins@* \
           node_modules/phaser \
           node_modules/phaser3-rex-plugins

# ===== runner: 本番起動 (prod node_modules + ビルド成果物 + tsx実行に必要な最小ソース) =====
FROM node:${NODE_VERSION} AS runner
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HUSKY=0
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate \
    && addgroup -S app && adduser -S app -G app
# 本番依存のみ
COPY --from=prod-deps --chown=app:app /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=app:app /repo/apps/web/node_modules ./apps/web/node_modules
COPY --chown=app:app pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --chown=app:app apps/web/package.json ./apps/web/package.json
# Next ビルド成果物 (cache 除去済み) と公開アセット
COPY --from=builder --chown=app:app /repo/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=app:app /repo/apps/web/public ./apps/web/public
# tsx が実行時にコンパイルする custom server + サーバーコード + 設定
COPY --from=builder --chown=app:app /repo/apps/web/server.ts ./apps/web/server.ts
COPY --from=builder --chown=app:app /repo/apps/web/src ./apps/web/src
COPY --from=builder --chown=app:app /repo/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=builder --chown=app:app /repo/apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY --from=builder --chown=app:app /repo/apps/web/tsconfig.server.json ./apps/web/tsconfig.server.json
USER app
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
