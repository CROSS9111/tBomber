import Matter from 'matter-js';

import * as Constants from '../constants/constants';
import dropWalls from '../game_engine/services/dropWallService';
import PlacementObjectInterface from '../interfaces/placement_object';
import GameQueue from '../utils/gameQueue';
import GameEngine from './GameEngine';
import Block from './schema/Block';
import { Bomb } from './schema/Bomb';
import Enemy from './schema/Enemy';
import Item from './schema/Item';
import GameRoomState from './schema/GameRoomState';

export default class GameLoopManager {
  private isFinishedDropWallsEvent = false;
  private elapsedTime = 0;
  private readonly enemies = new Map<string, Enemy>();

  constructor(
    private readonly state: GameRoomState,
    private readonly engine: GameEngine,
  ) {}

  addEnemy(): void {
    const enemyCount = Constants.MAX_PLAYER - this.state.getPlayersCount();
    for (let i = 0; i < enemyCount; i++) {
      const enemy = this.engine.enemyService.addEnemy(`enemy-${i}`);
      this.enemies.set(`enemy-${i}`, enemy);
      this.state.enemies.push(enemy);
    }
  }

  tick(deltaTime: number): void {
    this.elapsedTime += deltaTime;

    this.state.timer.updateNow();
    this.timeEventHandler();
    this.enemyHandler();

    while (this.elapsedTime >= Constants.FRAME_RATE) {
      this.state.timer.updateNow();
      this.elapsedTime -= Constants.FRAME_RATE;

      for (const [, player] of this.state.players) {
        if (this.enemies.get(player.sessionId) === undefined) {
          this.engine.playerService.updatePlayer(player);
        } else {
          this.engine.enemyService.updateEnemy(player as Enemy);
        }
      }

      this.engine.bombService.updateBombCollision();
      this.engine.bombService.updateMovingBombs();

      this.objectCreateHandler(this.state.getBombToCreateQueue(), (bomb) =>
        this.createBombEvent(bomb as Bomb),
      );
      this.objectRemoveHandler(this.state.getBombToExplodeQueue(), (bomb) =>
        this.removeBombEvent(bomb as Bomb),
      );

      this.objectRemoveHandler(this.state.getBlockToDestroyQueue(), (block) =>
        this.removeBlockEvent(block as Block),
      );

      this.objectRemoveHandler(this.state.getItemToDestroyQueue(), (item) =>
        this.removeItemEvent(item as Item),
      );

      Matter.Engine.update(this.engine.engine, deltaTime);
    }
  }

  private timeEventHandler(): void {
    if (!this.state.gameState.isPlaying()) return;
    if (this.state.timer.getRemainTime() <= Constants.INGAME_EVENT_DROP_WALLS_TIME) {
      if (!this.isFinishedDropWallsEvent) {
        dropWalls(this.engine);
      }
      this.isFinishedDropWallsEvent = true;
    }
  }

  private enemyHandler(): void {
    if (!this.state.gameState.isPlaying()) return;
    if (!this.state.timer.isOpeningFinished()) return;
    this.engine.enemyService.calcAdjustablePosition();
  }

  private objectCreateHandler(
    queue: GameQueue<PlacementObjectInterface>,
    callback: (data: PlacementObjectInterface) => void,
  ): void {
    while (!queue.isEmpty()) {
      const data = queue.read();
      if (data === undefined || !data.isCreatedTime()) break;
      callback(data);
      queue.dequeue();
    }
  }

  private objectRemoveHandler(
    queue: GameQueue<PlacementObjectInterface>,
    callback: (data: PlacementObjectInterface) => void,
  ): void {
    while (!queue.isEmpty()) {
      const data = queue.read();
      if (data === undefined || !data.isRemovedTime()) break;
      callback(data);
      queue.dequeue();
    }
  }

  private createBombEvent(bomb: Bomb): void {
    const isPlaced = this.engine.playerService.placeBomb(bomb);
    if (isPlaced) {
      this.state.getBombToExplodeQueue().enqueue(bomb);
    } else {
      this.engine.bombService.deleteBomb(bomb);
    }
  }

  private removeBombEvent(bomb: Bomb): void {
    this.engine.bombService.explode(bomb);
  }

  private removeBlockEvent(block: Block): void {
    this.engine.mapService.destroyBlock(block);
  }

  private removeItemEvent(item: Item): void {
    this.engine.itemService.removeItem(item);
  }
}
