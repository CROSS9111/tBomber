import Matter from 'matter-js';

import * as Constants from '../../constants/constants';
import GameEngine from '../../rooms/GameEngine';
import { Bomb, getSettablePosition } from '../../rooms/schema/Bomb';
import Player from '../../rooms/schema/Player';
import { PixelToTile, TileToPixel } from '../../utils/map';
import BlastService from './blastService';

interface MovingBombState {
  dir: Constants.DIRECTION_TYPE;
  targetX: number; // 次に到達するマス中心の x (px)
  targetY: number; // 次に到達するマス中心の y (px)
}

export default class BombService {
  private readonly gameEngine: GameEngine;
  // 蹴られて移動中の爆弾の状態 (クライアントには x/y のみ同期するためサーバー内部で保持)
  private readonly movingBombs = new Map<string, MovingBombState>();

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  // ボムを matter に追加する
  addBomb(bomb: Bomb): boolean {
    const bombBody = Matter.Bodies.rectangle(
      bomb.x,
      bomb.y,
      Constants.DEFAULT_TIP_SIZE,
      Constants.DEFAULT_TIP_SIZE,
      {
        label: Constants.OBJECT_LABEL.BOMB,
        isSensor: true,
        isStatic: true,
      },
    );

    Matter.Composite.add(this.gameEngine.world, [bombBody]);
    this.gameEngine.bombBodies.set(bomb.id, bombBody);
    this.gameEngine.bombIdByBodyId.set(bombBody.id, bomb.id);
    return true;
  }

  // ボムを matter から削除する
  deleteBomb(bomb: Bomb) {
    this.movingBombs.delete(bomb.id);
    // 設置者のボム数を増やす
    const player = this.gameEngine.getPlayer(bomb.sessionId);
    if (player !== undefined) {
      // ボムを設置したプレイヤーの設置中のボム数を減らす
      player.decreaseSetBombCount();
    }
    this.gameEngine.state.deleteBomb(bomb);
    const bombBody = this.gameEngine.bombBodies.get(bomb.id);
    if (bombBody === undefined) return;
    this.gameEngine.bombBodies.delete(bomb.id);
    Matter.Composite.remove(this.gameEngine.world, bombBody);
  }

  // ボムをキューに詰めます
  enqueueBomb(player: Player) {
    if (player.isDead()) return;
    if (!player.canSetBomb()) return;

    const { bx, by } = getSettablePosition(player.x, player.y);
    if (this.isExistsBombOnPosition(bx, by)) return;
    player.increaseSetBombCount();
    const bomb = new Bomb(bx, by, player.getBombType(), player.getBombStrength(), player.sessionId);
    this.gameEngine.state.bombs.set(bomb.id, bomb);
    this.gameEngine.state.getBombToCreateQueue().enqueue(bomb);
  }

  explode(bomb: Bomb) {
    // 既に爆発している場合は処理を終了する
    if (bomb.isExploded()) return;

    bomb.explode();

    // 爆風を作成する
    const blastService = new BlastService(this.gameEngine, bomb);
    blastService.add();

    // ボムを削除する
    this.deleteBomb(bomb);
  }

  // 誘爆の処理
  detonated(bombId: string) {
    const bomb = this.gameEngine.state.bombs.get(bombId);
    if (bomb === undefined) return;

    // 誘爆の場合は爆発までの delay を入れる
    this.gameEngine.room.clock.setTimeout(
      () => this.explode(bomb),
      Constants.BOMB_DETONATION_DELAY,
    );
  }

  // 指定した位置にボムが存在するかどうかを返す
  private isExistsBombOnPosition(x: number, y: number): boolean {
    let isExists = false;
    const { x: tx, y: ty } = PixelToTile(x, y);

    // すでに matter に追加されているボムのリストをチェックする
    this.gameEngine.bombBodies.forEach((bombBody) => {
      if (bombBody.position.x === x && bombBody.position.y === y) {
        isExists = true;
      }
    });

    if (isExists) return true;

    // まだ matter に追加されていないボムのリストをチェックする
    this.gameEngine.state.bombs.forEach((bomb) => {
      const { x: bx, y: by } = PixelToTile(bomb.x, bomb.y);
      if (tx === bx && ty === by) isExists = true;
    });
    return isExists;
  }

  // 現在のボムのリストを返す
  private listBombs(): Matter.Body[] {
    return Array.from(this.gameEngine.bombBodies.values());
  }

  // 爆弾の衝突判定を更新する
  updateBombCollision() {
    this.setSensorFalseIfNoBodyOverlapped();
  }

  // 全ての爆弾に対して、爆弾に他のオブジェクトが重なっていない場合は衝突判定を有効にする
  private setSensorFalseIfNoBodyOverlapped() {
    this.listBombs().forEach((bombBody) => {
      // すでに当たり判定があるなら何もしない
      if (!bombBody.isSensor) return;

      const bombId = this.gameEngine.bombIdByBodyId.get(bombBody.id);
      if (bombId === undefined) return;
      const bomb = this.gameEngine.state.bombs.get(bombId);
      if (bomb === undefined) return;

      // ボムが爆発している場合は処理を終了する
      if (bomb.isExploded()) return;

      // 蹴られて移動中のボムは sensor のまま (通過させる) なので判定しない
      if (bomb.isMoving) return;

      // ボムに重なっているオブジェクトの取得
      const bodies = Matter.Query.point(this.gameEngine.world.bodies, {
        x: bombBody.position.x,
        y: bombBody.position.y,
      });

      if (bodies.length <= 1) Matter.Body.set(bombBody, 'isSensor', false);
    });
  }

  /*
  蹴る (kick) 関連
  */

  // 方向を (dx, dy) のタイル差分に変換する
  private directionToDelta(dir: Constants.DIRECTION_TYPE): { dx: number; dy: number } {
    switch (dir) {
      case Constants.DIRECTION.UP:
        return { dx: 0, dy: -1 };
      case Constants.DIRECTION.DOWN:
        return { dx: 0, dy: 1 };
      case Constants.DIRECTION.LEFT:
        return { dx: -1, dy: 0 };
      case Constants.DIRECTION.RIGHT:
        return { dx: 1, dy: 0 };
      default:
        return { dx: 0, dy: 0 };
    }
  }

  // 指定タイルに爆弾が移動可能か (空き / プレイヤー / アイテムなら可、壁・箱・他爆弾は不可)
  private isTileKickable(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX >= Constants.TILE_COLS || tileY >= Constants.TILE_ROWS) {
      return false;
    }
    const { x, y } = TileToPixel(tileX, tileY);
    const bodies = Matter.Query.point(this.gameEngine.world.bodies, { x, y });
    return this.gameEngine.checkMovable(bodies) === Constants.OBJECT_IS_MOVABLE.NONE;
  }

  // 爆弾を指定方向に蹴る。蹴れない (隣が壁等) 場合は何もしない
  // playerX/Y は蹴ろうとしているプレイヤーの座標 (進行方向の隣マスから踏み込んだ時だけ蹴る判定に使う)
  kickBomb(bomb: Bomb, dir: Constants.DIRECTION_TYPE, playerX: number, playerY: number) {
    if (bomb.isMoving || bomb.isExploded()) return;

    const { dx, dy } = this.directionToDelta(dir);
    if (dx === 0 && dy === 0) return;

    const { x: tx, y: ty } = PixelToTile(bomb.x, bomb.y);

    // 進行方向の隣マスに爆弾がある (= 別マスから踏み込んだ) 時だけ蹴る。
    // 置いた直後の爆弾から降りる際に自分の爆弾を誤って蹴るのを防ぐ。
    const { x: ptx, y: pty } = PixelToTile(playerX, playerY);
    if (ptx + dx !== tx || pty + dy !== ty) return;

    if (!this.isTileKickable(tx + dx, ty + dy)) return;

    bomb.isMoving = true;
    const { x: targetX, y: targetY } = TileToPixel(tx + dx, ty + dy);
    this.movingBombs.set(bomb.id, { dir, targetX, targetY });

    // 移動中はすり抜けさせる (プレイヤーを押し出さない)。停止時に再び当たり判定を有効化する
    const bombBody = this.gameEngine.bombBodies.get(bomb.id);
    if (bombBody !== undefined) Matter.Body.set(bombBody, 'isSensor', true);
  }

  // 移動中の爆弾を毎フレーム進める。GameRoom の固定フレーム更新から呼ぶ
  updateMovingBombs() {
    this.movingBombs.forEach((mv, id) => {
      const bomb = this.gameEngine.state.bombs.get(id);
      const bombBody = this.gameEngine.bombBodies.get(id);
      if (bomb === undefined || bombBody === undefined || bomb.isExploded()) {
        this.movingBombs.delete(id);
        return;
      }

      // タイマー再評価の保険: 移動中に爆発時刻が来たら、最寄りのマス中心にスナップして停止する。
      // (マスの途中で爆発する理不尽死を防ぎ、爆風を必ずグリッドに揃える)
      if (bomb.isRemovedTime()) {
        this.snapBombToTile(bomb, bombBody);
        this.stopBomb(bomb, bombBody);
        return;
      }

      const { dx, dy } = this.directionToDelta(mv.dir);
      const isHorizontal = dx !== 0;
      const remaining = isHorizontal ? mv.targetX - bomb.x : mv.targetY - bomb.y;
      const step = Constants.KICK_BOMB_SPEED;

      if (Math.abs(remaining) <= step) {
        // 目標マス中心に到達 → スナップして次マスへ進めるか判定する
        bomb.x = mv.targetX;
        bomb.y = mv.targetY;
        Matter.Body.setPosition(bombBody, { x: bomb.x, y: bomb.y });

        const { x: tx, y: ty } = PixelToTile(bomb.x, bomb.y);
        if (this.isTileKickable(tx + dx, ty + dy)) {
          const { x: targetX, y: targetY } = TileToPixel(tx + dx, ty + dy);
          mv.targetX = targetX;
          mv.targetY = targetY;
        } else {
          this.stopBomb(bomb, bombBody);
        }
      } else {
        bomb.x += dx * step;
        bomb.y += dy * step;
        Matter.Body.setPosition(bombBody, { x: bomb.x, y: bomb.y });
      }
    });
  }

  // 爆弾を最寄りのマス中心に揃える
  private snapBombToTile(bomb: Bomb, bombBody: Matter.Body) {
    const { bx, by } = getSettablePosition(bomb.x, bomb.y);
    bomb.x = bx;
    bomb.y = by;
    Matter.Body.setPosition(bombBody, { x: bx, y: by });
  }

  // 爆弾の移動を停止し、当たり判定を元に戻す
  private stopBomb(bomb: Bomb, bombBody: Matter.Body) {
    bomb.isMoving = false;
    this.movingBombs.delete(bomb.id);
    Matter.Body.set(bombBody, 'isSensor', false);
  }
}
