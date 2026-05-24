# FuzeFur — Next.js 統合版

> **FuzeFur** はこのプロジェクトのプロダクト名（ブランド）です。
> 「インストール不要・URL1本で即対戦できる爆弾アクション対戦ゲーム」として展開予定。
> 元となったオンライン対戦ゲーム「ボムボムパニック」については「元プロジェクトについて」を参照してください。

オンライン対戦ボンバーマン風ゲーム [recursion-team-v/bomb](https://github.com/recursion-team-v/bomb) を、
**Next.js (App Router) + Colyseus** を 1 プロセスに統合する形にリファクタリングしたもの。

## 元プロジェクトについて

本プロジェクトは、チームで約 1.5 ヶ月かけて開発されたオンライン対戦ボンバーマン風ゲーム「ボムボムパニック」を元にしています。
開発の経緯・設計（サーバー権威型アーキテクチャ、ネットワーク遅延を考慮した爆発・連鎖の同期、influence map を用いた AI など）については、作者による解説記事を参照してください。

- 元記事: [オンライン対戦ができるボンバーマン風なゲームを作った（ボムボムパニック）](https://blog.framinal.life/entry/bombompanic)（著者: lirlia）
- 元リポジトリ: [recursion-team-v/bomb](https://github.com/recursion-team-v/bomb)

## セットアップ

```bash
pnpm install
pnpm dev                  # 開発サーバー (HMR 付き、tsx watch)
pnpm build && pnpm start  # 本番モード
```

- `http://localhost:3000` でタイトル画面
- `http://localhost:3000/monitor` で Colyseus モニタ (Basic 認証 admin / admin)
- Colyseus WebSocket と Next.js HMR はパス分岐で同居 (`/_next/*` だけ Next にルーティング)

## スクリプト

| コマンド | 用途 |
|---|---|
| `pnpm dev` | tsx watch で server.ts + Next.js dev を 1 プロセス起動 |
| `pnpm build` | `next build --webpack` (Turbopack でなく webpack。Phaser externals / rex の minify 制御に必須) |
| `pnpm start` | 本番モードで tsx 経由 server.ts を起動 |
| `pnpm lint` / `pnpm lint:fix` | ESLint CLI (flat config: next/core-web-vitals + prettier) |
| `pnpm format` / `pnpm format:check` | Prettier (整形 / 差分検出) |
| `pnpm typecheck` | `tsc --noEmit` を Next.js 用 + server 用の両 tsconfig で |

## 構成

```
bom/
├── pnpm-workspace.yaml
├── package.json                  # ルート (workspace, dev/build/start のエイリアス)
├── apps/
│   └── web/                      # Next.js 単一アプリ
│       ├── server.ts             # カスタムサーバー (Next + Colyseus)
│       ├── next.config.mjs       # webpack: Phaser externals + Terser で rex を minify 保護
│       ├── eslint.config.mjs     # ESLint flat config (next/core-web-vitals + prettier)
│       ├── tsconfig.json         # Next.js (bundler モジュール解決)
│       ├── tsconfig.server.json  # server.ts 用 (CommonJS)
│       ├── public/               # 旧 frontend/public をそのまま
│       └── src/
│           ├── app/              # App Router (layout/page/globals.css)
│           ├── components/
│           │   └── PhaserMount.tsx  # 'use client' + dynamic import
│           ├── game/             # 旧 frontend/src (Phaser + scenes + services …)
│           └── server/           # 旧 backend/src (Colyseus rooms + game_engine …)
```

## 主な変更点

| 項目 | 旧 | 新 |
|---|---|---|
| ビルド/開発 | Vite | Next.js 16 (App Router, webpack ビルド) |
| サーバー起動 | `backend/src/index.ts` (Express + Colyseus 単独) | `apps/web/server.ts` (Next + Colyseus を同一 HTTP サーバーに mount) |
| パッケージマネージャ | npm × 2 リポジトリ | pnpm workspaces |
| frontend → backend のクロス参照 | `'../../backend/src/...'` | TS path alias `'@server/...'` |
| 環境変数 | `import.meta.env.PROD` / `VITE_SERVER_URL` | `process.env.NODE_ENV` / `NEXT_PUBLIC_SERVER_URL` |
| WebSocket 接続先 | `ws://host:2567` (固定) | `ws://host` (Next と同一ポート 3000) |

## 仕組み (Phaser の取り扱い)

Phaser は `window.navigator` 等のブラウザグローバルが必要なので、
`PhaserMount.tsx` で `'use client'` + `useEffect` 内で動的 `import('@game/PhaserGame')` する。
Next.js の SSR/SSG はスキップ (`dynamic(..., { ssr: false })`)。

## HMR と Colyseus の同居

`Colyseus.Server({ server })` は HTTP サーバーの `upgrade` イベントを全て掴むので、
そのままだと Next の HMR (`ws://.../_next/webpack-hmr`) が落ちる。
`server.ts` で listener を取り外し → パスで分岐 → `nextApp.getUpgradeHandler()` または Colyseus に振り分けて再装着している。
