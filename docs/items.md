# アイテム仕様（ITEM_TYPE 一覧）

FuzeFur のゲーム内アイテムの一覧と仕組み。定義の実体は
[`apps/web/src/server/constants/constants.ts`](../apps/web/src/server/constants/constants.ts) にあり、
本ドキュメントはそのリファレンス。値を変更したら本書も更新すること。

## 一覧

| ITEM_TYPE | 効果 | 1取得の増分 | 配置数 | タイトルカード | アセット | 反映フィールド（同期） |
|---|---|---|---|---|---|---|
| `BOMB_POSSESSION_UP` | 設置できる爆弾の最大数 +1 | 1 | 12 | ✓ Possession Up | `item_bomb_up.png` | `Player.maxBombCount` |
| `BOMB_STRENGTH` | 爆風の威力 +1 | 1 | 12 | ✓ Strength Up | `item_bomb_strength.png` | `Player.bombStrength` |
| `PLAYER_SPEED` | 移動速度 +0.25 | 0.25 | 8 | ✓ Speed Up | `item_player_speed.png` | `Player.speed` |
| `HEART` | HP +1 | 1 | 3 | ✓ HP Up | `item_heart.png` | `Player.hp` |
| `KICK` | 爆弾を蹴れるようになる | ON/OFF | 2 | ✓ Kick Bomb | `item_kick.png` ※暫定アート | `Player.canKick` |
| `PENETRATION_BOMB` | 設置する爆弾が貫通爆弾になる | ON/OFF | **0（無効）** | ✗ | `item_penetration_bomb.png` | `Player.bombType` |
| `NONE` | 効果なし（ブロックの中身が空） | - | 0 | - | - | - |

- **配置数** = `ITEM_PLACE_COUNT`。破壊可能ブロックの中にこの数だけ仕込まれる（1試合あたり）。
- **`PENETRATION_BOMB` は配置数 0 のため通常プレイでは出現しない**（定義のみ残存）。
- **`KICK` のアイコンは暫定プレースホルダー**（96×96 / オレンジのブーツ）。正式アートは後日差し替え予定。

## 上限・初期値（`constants.ts`）

| ステータス | 初期値 | 上限 |
|---|---|---|
| HP | `INITIAL_PLAYER_HP` = 1 | `MAX_PLAYER_HP` = 3 |
| 爆弾所持数 | `INITIAL_SETTABLE_BOMB_COUNT` = 1 | `MAX_SETTABLE_BOMB_COUNT` = 8 |
| 威力 | `INITIAL_BOMB_STRENGTH` = 2 | `MAX_BOMB_STRENGTH` = 12 |
| 速度 | `INITIAL_PLAYER_SPEED` = 2.5 | `MAX_PLAYER_SPEED` = 5 |

各 setter（`Player.setBombStrength` / `setSpeed` / `increaseMaxBombCount`）は上限でクランプされる。

## 配置の仕組み

[`mapService.createMapBlocks`](../apps/web/src/server/game_engine/services/mapService.ts)：

1. `ITEM_PLACE_COUNT` から「種類×個数」のアイテム配列を生成。
2. 破壊可能ブロック数に満たない分は `NONE` で埋める。
3. 配列をシャッフルし、各ブロックに割り当てる。
4. ブロックが**爆風で破壊された時**に、そのブロックに割り当てられたアイテム（`NONE` 以外）が出現する。

## 取得の仕組み

[`collision_handler/player.ts` の `playerToItem`](../apps/web/src/server/game_engine/collision_handler/player.ts)：

- プレイヤー（CPU含む）がアイテムに重なると、`ITEM_TYPE` に応じて効果を適用。
- 取得後は `setObtained()` で取得済みにし、`Player.incrementItem()` で取得履歴（`getItemMap`）に加算、削除キューへ。
- `getItemMap` は**サーバー内部のみ**（同期されない）。実際の効果は上表の「反映フィールド」（同期される）に乗る。

## 死亡時のドロップ

[`playerService.diePlayer`](../apps/web/src/server/game_engine/services/playerService.ts)：

- 死亡したプレイヤーが取得していたアイテム（`getItemMap`）を、空きマスにランダムに落とす。
- **`HEART` はドロップしない**。それ以外（`KICK` 含む）はドロップし、他プレイヤーが拾える。
- 落下までの遅延は `ITEM_DROP_TIME_WHEN_PLAYER_DEAD` = 2000ms。

## ヘッダー表示

[`scenes/GameHeader.ts`](../apps/web/src/game/scenes/GameHeader.ts) のHUD：

- `HP:n` ／ 💣 爆弾所持数 `×n` ／ 威力 `×n` ／ 速度 `×n` を常時表示。
- 貫通爆弾を取得すると爆弾アイコンが貫通版に変化。
- **`KICK` は取得時のみ**ブーツアイコンを表示（数えない ON/OFF 能力のため）。

## 関連定数（`constants.ts`）

- `ITEM_TYPE` / `ITEM_PLACE_COUNT` / `ITEM_INCREASE_RATE`
- `ITEM_INVINCIBLE_TIME` = 100ms（出現直後、残存爆風で即破壊されない猶予）
