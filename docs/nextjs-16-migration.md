# Next.js 14.2.35 → 16 移行計画（チーム合意版）

> 3ロール（migration-lead / build-tooling / runtime-compat）が公式アップグレードガイド・
> 関連 PR・実コードを精査し、ライブ・ディベートで合意した移行計画。作成: 2026-05-24

## 結論（TL;DR）

**移行は実現可能。** 最大の壁は `swcMinify: false`（phaser3-rex-plugins 対策）だが、
**webpack を継続（`next build --webpack`）し Terser で rex を minify 除外**すれば解決できる。
**14→15→16 の段階移行（Phase 0 ＋ 2リリース）**で進め、**Turbopack 全面移行は別フェーズ**に切り出す。
本アプリは「ほぼ CSR(Phaser) ＋ カスタムサーバー(Colyseus)」のため、async/caching 系の破壊的変更は**すべてノーオペ**。

## ⚠️ 最重要の落とし穴

**Next 16 は Turbopack がデフォルト。`next build`（`--webpack` 無し）はビルドが成功するのに、
webpack の `externals`(Phaser CDN)・`alias`・`fallback`・移行後の Terser 設定が silently 無視され、
本番実行時に Phaser externals も rex minify 保護も効かず崩壊する。**
→ **`build` は必ず `next build --webpack` にする**（怠ると「ビルド成功・本番で壊れる」最悪パターン）。

## 本アプリに実際に効く破壊的変更（6件・精査確定）

| # | 変更 | 影響 | 対応 | 顕在化 |
|---|---|---|---|---|
| 1 | webpack カスタム設定があると `next build` 失敗（Turbopackデフォルト） | **最重要** | `next build --webpack` 必須 | v16 |
| 2 | `swcMinify` オプション削除（SWC minify 常時有効） | rex 名前空間破壊の懸念 | Phase 0 で webpack Terser 自前制御＋`swcMinify:false` 削除 | v15 |
| 3 | Server Component で `dynamic(ssr:false)` 禁止 | `page.tsx` がビルドエラー | `'use client'` 化 or Client ラッパーへ退避（数行） | v15 |
| 4 | `next lint` 廃止 | `lint`/`lint:fix` スクリプト | ESLint CLI（flat config）へ。codemod `next-lint-to-eslint-cli`＋CI更新 | v16 |
| 5 | `next.config` の `eslint` オプション削除 | `eslint:{ignoreDuringBuilds:true}` が config エラー | 単純削除（CI に独立 lint step あり＝デグレなし） | v16 |
| 6 | Node 20.9+ / TS 5.1+ 必須・React 19 同梱 | 環境更新 | Docker ベースを `22-alpine` 等へ、types 更新（現状 TS^5.4/@types/node^20 は概ね可） | v16 |

### ノーオペ（grep / 実コード精査で確認、対応不要）
async request APIs（`cookies/headers/params/searchParams/draftMode` 使用 0 件）、caching デフォルト変更
（Route Handler / Server 側 fetch なし）、`next/font`（不使用）、`middleware→proxy`（middleware なし）、
動的 metadata（静的 metadata のみ）。app 配下は `layout.tsx` + `page.tsx` + `globals.css` のみ、`'use client'` は `PhaserMount` 1件。

## 移行フェーズ

### Phase 0 — rex minify 保護の確立（Next 14 のまま・先行リリース）
- `next.config.mjs` の `webpack()` 内で `config.optimization.minimizer` に **TerserPlugin を注入**し、
  **`exclude: /phaser3-rex-plugins/`** で rex を minify 完全除外（CSS minimizer は温存）。
  必要に応じて `keep_classnames` / `keep_fnames` / `mangle.reserved` でサイズ最適化。
- これにより **`swcMinify: false` への依存を解消**（まだ削除はしない／Next14では無害）。
- **回帰確認（受け入れ条件）**: 本番ビルドで rex の prototype 拡張機能
  （VirtualJoystick / RexUIPlugin / ButtonPlugin / GridTable / Dialog 等）が動作すること。
  `layout.tsx` のコメントにある「本番最適化で rex 名前空間が壊れる」問題が再発しないこと。
- 独立リリースで安全網を張る（ここが唯一の技術的不確実性）。

### Phase 1 — 14 → 15（リリース①）
- `npx @next/codemod@latest upgrade` を起点に 15 へ。React 18→19・`@types/react(-dom)` 19 へ。
- 手修正は **1点**: `page.tsx` の `dynamic(..., { ssr:false })`（Server Component で禁止）→ `'use client'` 化 or Client ラッパーへ。
- `swcMinify: false` を手動削除（codemod 非対応）。Phase 0 の Terser 制御が効いていることを確認。
- 本番ビルド＋実機ゲーム動作（特に rex UI）を確認。

### Phase 2 — 15 → 16（リリース②）
- `build` を **`next build --webpack`** に変更（必須・上記の落とし穴）。
- **dev/start のバンドラ固定**（R1・要検証）: dev=`tsx watch server.ts` / start=`tsx server.ts` は
  next CLI を通らず `next({dev})` プログラム API 経由。`--webpack` を置く場所が無いため、
  **`next({ dev, webpack: true })`（＋ `TURBOPACK` env 保険）でコード側で webpack 固定**。
  ※ programmatic で webpack フラグが効くかは Next 本体の取込パッチ（PR #84281 系）依存 → **インストールした 16.x で実機確認必須**。
  固定できれば HMR の `/_next/webpack-hmr` upgrade 分岐は現状維持。
- `next.config` から `eslint` ブロック削除（#5）。`next lint` → ESLint CLI flat config（#4）＋ GitHub Actions の lint step 更新。
- Dockerfile の `ARG NODE_VERSION` を `22-alpine`（または最低 `20.18-alpine`）へ。TS/Node 要件確認。
- 本番ビルド＋実機動作の最終回帰。

## リスク

| ID | リスク | 度 | 緩和策 |
|---|---|---|---|
| R1 | dev の programmatic `next({dev})` が webpack を維持できるか（Turbopack 化で HMR upgrade 分岐が壊れる） | 中 | `webpack:true`＋env、16.x で実機確認。ダメなら Turbopack HMR 経路に合わせ `server.ts` の upgrade 分岐を見直し |
| R2 | `--webpack` 忘れ＝ビルド成功・本番崩壊 | 中 | `build` スクリプトに `--webpack` 固定、CI で本番ビルド＋起動スモーク |
| R3 | 本番 minify が rex 名前空間を破壊（既知問題の再発） | 中 | Phase 0 で先行検証、rex 各プラグインの実機回帰テスト |
| R4 | React 19 + Phaser CDN(beforeInteractive) のロード順 / StrictMode 二重マウント | 低 | PhaserMount は mountedRef でガード済。実害低 |

## 工数感
- **小〜中**。コード修正は `page.tsx`(1点) ＋ `next.config`(minimizer 注入・`swcMinify`/`eslint` 削除) ＋ lint スクリプト/CI ＋ Docker Node。
- 山は **Phase 0 の rex minify 保護検証** と **R1（dev バンドラ固定）の 16.x 実機確認**。ここを先に潰せば残りは機械的。
- React19/codemod はコード本体と独立に進行可。各 Phase 単位で revert 可能（段階リリース）。

## スコープ外（別フェーズ）／Turbopack について（確定）
**Turbopack 全面移行は現時点で技術的に不可**（よって `next build --webpack` は「推奨」でなく「唯一解」）。
- 肝の `externals: { phaser: 'Phaser' }`（Phaser を CDN の `window.Phaser` に外部化）に **Turbopack の等価機能が無い**。
  `serverExternalPackages` はサーバー側 require の外部化であり、クライアントを `window.Phaser` に向ける用途を満たさない。
- `alias`/`fallback` は Turbopack の `resolveAlias`（empty module）で翻訳可能だが、Phaser externals が再現できない以上 Turbopack build は不成立。

将来 Turbopack に移行するなら、前提条件は **「Phaser externals の代替手段」の確立**（CDN グローバル解決の別実装 or Phaser をバンドル取込みつつ minify 保護）。
その際は dev HMR のパスも変わるため `server.ts` の upgrade 分岐見直しが宿題。
