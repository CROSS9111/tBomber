# デプロイ先計画書（MVP）

> 3ロール（cost-infra / platform-fit / devex-ops）が 2026 年時点の各社仕様・料金を
> WebSearch で確認しつつライブ・ディベートで決定した、FuzeFur MVP のデプロイ方針。
> 作成: 2026-05-24

## 結論（TL;DR）

**MVP は Fly.io にデプロイする。** Docker 化済みイメージを無改変で常駐でき、WebSocket(Colyseus)・
メモリ状態保持が前提設計、しかも**常駐構成で最安（≈ $3-4/月）**。コスト最安と技術適合の最良が同一候補で一致した。
**DX（git push で即デプロイ・運用ゼロ）を最優先するなら Railway（≈ $5/月）が次点**で、差は月 $1-2 のみ。

## 要件（前提）

FuzeFur は **Next.js 16 + Colyseus(サーバー権威リアルタイム対戦) + Phaser** を
**カスタムサーバー `server.ts` に1プロセス同居**させた構成（ポート3000で HTTP + Next + WebSocket）。Docker 化済み（~474MB / Node 22-alpine / `tsx server.ts`）。

- **常駐・ステートフルな WebSocket サーバーが必須**: ルーム状態をメモリに保持し、WS 接続を維持し続ける。
- **サーバーレス（Vercel 等）は不可**: カスタムサーバーを実行せず、短命・ステートレスで Colyseus を保持できない。
- MVP は個人〜数人開発・低予算・最速重視。初期はほぼ無トラフィック〜たまにスパイク。スケールは後回し可。

## 比較（常駐 no-sleep 前提の月額）

| 候補 | MVP月額 | WS/常駐/ステートフル適合 | Docker/DX | 判定 |
|---|---|---|---|---|
| **Fly.io** | **≈ $3-4**（shared-cpu-1x / 512MB 常駐） | ◎ Firecracker microVM＝伝統的サーバー。WS永続・メモリ状態が前提 | Docker 無改変。`fly launch`/`fly deploy`、CLI/fly.toml が一手間 | **★採用** |
| Railway | ≈ $5（Hobby 最低固定） | ◎ 常駐コンテナ・timeout 天井なし | ◎ git push 即デプロイ・GUI・WSS/ログ/ロールバック標準＝**DX最良** | 次点（DX最優先なら） |
| Render | ≈ $7/サービス（Starter） | ○ 常駐WS可 | ○ GitHub連携・PRプレビュー | 割高で脱落 |
| Hetzner VPS | ≈ $4 固定（CAX11） | ◎ 何でも可 | △ OS/Docker/TLS/監視を**全部自前**＝MVP最速に反する | 非推奨 |
| Cloud Run | ≈ $47（min-instances=1 + CPU always-on） | ✗ リクエスト駆動・scale-to-zeroで全切断・インスタンス間で状態分散 | △ | **不適合・除外** |
| 各社「無料枠」 | $0 | ✗ **アイドルでスリープ→ルーム消滅・WS全切断・コールドスタート** | - | **ゲーム用途で破綻・除外** |

> 重要: 「無料だがスリープ」は WS ゲームでは致命的（接続断＋メモリ上のルーム状態消滅）。
> **最初から「数ドルで常駐」を選ぶ**のが正解。Fly の無料枠は 2024 に廃止済み。

## 採用案: Fly.io 構成

### コスト
- shared-cpu-1x / **512MB** 常駐で **≈ $3-4/月**（474MB イメージ＋Colyseus 同居のため 256MB ($2) ではメモリ不足リスク → 512MB 推奨）。
- 単一リージョン・単一マシンで MVP は十分。

### 必須設定（`fly.toml` — 踏むと致命的だが設定一発）
1. **`auto_stop_machines = false` / `min_machines_running = 1`** … 常駐固定。忘れるとアイドルで停止し**ルーム消滅・WS全切断**。
2. **マシンは1台固定（`count = 1`）** … Colyseus のインメモリ・ルーム権威は**単一プロセス前提**。複数化は Redis Presence を足す段で。
3. **`internal_port = 3000`** ／ `[http_service]` の `concurrency.type = "connections"`（WS接続数基準）。**TLS/WSS 終端は Fly が自動**。

### デプロイ手順（既存 Dockerfile をそのまま使用）
1. `fly launch`（既存 `Dockerfile` を検出、`fly.toml` 生成）→ 上記の必須設定を反映。
2. `fly secrets set ...` で環境変数・秘密情報を投入（`NEXT_PUBLIC_SERVER_URL` は同一ホスト運用なら不要）。
3. `fly deploy` でイメージをビルド＆デプロイ。`fly logs` / `fly status` で確認。
4. 独自ドメイン: `fly certs add <domain>`（HTTPS/WSS 自動）。
5. **`/monitor`（Colyseus monitor）の保護**: 現状 Basic 認証 admin/admin → 本番では強パスワード化（`fly secrets`）or 無効化。

### スケール道（MVP では不要・将来）
同接が増えたら → マシン水平増設（`count > 1`）＋ **Colyseus 0.15 の Redis Presence** でルーム状態を共有 → さらに**多リージョン**展開も microVM 常駐のまま伸ばせる。MVP では一切不要だが詰みにくい。

## 次点案: Railway（DX 最優先なら）

- **git push → Dockerfile 自動検出 → 即デプロイ**。env/secret は GUI、ログ/メトリクス/ロールバック/独自ドメイン+自動HTTPS(WSS) が標準で**運用ほぼゼロ**。常駐WS・ステートフルもそのまま。
- 既存 GitHub Actions とも「Wait for CI」連動が容易。
- 減点: コストが Fly より月 $1-2 高い（$5 固定）／2025-12 に EU West でビルド全停止の障害履歴。
- **「最速で出す・運用に一切手をかけたくない」を最優先するなら Railway が妥当**。

## 除外理由（全員一致）
- **Cloud Run**: WS のリクエスト timeout・scale-to-zero で全切断・インスタンス間でメモリ状態が分散 → Colyseus と不適合。
- **Hetzner VPS**: 機能は満点・最安級だが OS/Docker/TLS/監視/更新を全部自前 → MVP の「運用ゼロ・最速」に反する。
- **無料枠（Render/Koyeb 等）**: アイドルでスリープ → ルーム消滅・WS切断で破綻。

## MVP リリース・チェックリスト
- [ ] Fly.io アカウント作成・`flyctl` セットアップ
- [ ] `fly launch`（Dockerfile 検出）→ `fly.toml` に常駐固定3設定（auto_stop off / min=1 / count=1 / port 3000 / connections）
- [ ] `fly secrets` で本番設定（`/monitor` のパスワード強化）
- [ ] `fly deploy` → `fly status`/`fly logs` で起動・WS 接続を確認（タイトル→対戦が動くか）
- [ ] 独自ドメイン + `fly certs`（WSS 確認）
- [ ] （任意）GitHub Actions から `fly deploy` を CD 連携
