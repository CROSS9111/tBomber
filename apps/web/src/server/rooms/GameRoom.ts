import { Client, Room } from 'colyseus';

import { IS_BACKEND_DEBUG } from '..';
import * as Constants from '../constants/constants';
import GameEngine from './GameEngine';
import GameLoopManager from './GameLoopManager';
import GameRoomState from './schema/GameRoomState';

export default class GameRoom extends Room<GameRoomState> {
  engine!: GameEngine;
  private name?: string;
  private loopManager!: GameLoopManager;

  async onCreate(options: any) {
    const { autoDispose, playerName } = options;
    this.name = playerName;
    this.maxClients = Constants.MAX_PLAYER;
    this.autoDispose = autoDispose;
    await this.setMetadata({ name: this.name, locked: false });

    this.clock.start();
    this.setState(new GameRoomState());
    this.engine = new GameEngine(this);
    this.loopManager = new GameLoopManager(this.state, this.engine);

    this.onMessage(
      Constants.NOTIFICATION_TYPE.PLAYER_GAME_STATE,
      (client, gameState: Constants.PLAYER_GAME_STATE_TYPE) => {
        switch (gameState) {
          case Constants.PLAYER_GAME_STATE.READY: {
            if (this.state.gameState.isPlaying()) {
              const data = { serverTimer: this.state.timer };
              client.send(Constants.NOTIFICATION_TYPE.GAME_START_INFO, data);
              return;
            }

            const myPlayer = this.state.getPlayer(client.sessionId);
            if (myPlayer === undefined) return;
            myPlayer.setGameState(gameState);
            this.broadcast(Constants.NOTIFICATION_TYPE.PLAYER_IS_READY, client.sessionId);

            let isLobbyReady = true;
            this.state.players.forEach(
              (player) => (isLobbyReady = isLobbyReady && player.isReady()),
            );
            if (isLobbyReady) {
              const data = { serverTimer: this.state.timer };
              this.startGame()
                .then(() => this.broadcast(Constants.NOTIFICATION_TYPE.GAME_START_INFO, data))
                .catch((err) => console.error(err));
            }
          }
        }
      },
    );

    this.onMessage(Constants.NOTIFICATION_TYPE.PLAYER_MOVE, (client, data: any) => {
      const player = this.state.getPlayer(client.sessionId);
      if (player === undefined) return;
      if (player.isDead()) return;
      player.inputQueue.push(data);
    });

    this.onMessage(Constants.NOTIFICATION_TYPE.PLAYER_BOMB, (client) => {
      const player = this.state.getPlayer(client.sessionId);
      if (player === undefined) return;
      this.engine.bombService.enqueueBomb(player);
    });

    this.onMessage(
      Constants.NOTIFICATION_TYPE.CHARACTER_SELECT,
      (client, data: { character: string }) => {
        if (this.state.gameState.isPlaying()) return;
        const player = this.state.getPlayer(client.sessionId);
        if (player === undefined) return;
        if (!Constants.CHARACTERS.includes(data.character)) return;
        player.character = data.character;
      },
    );

    this.onMessage(Constants.NOTIFICATION_TYPE.CHAT_MESSAGE, (client, data: { text: string }) => {
      const player = this.state.getPlayer(client.sessionId);
      if (player === undefined) return;
      const text = String(data.text).trim().slice(0, 100);
      if (text.length === 0) return;
      this.broadcast(Constants.NOTIFICATION_TYPE.CHAT_MESSAGE, { playerName: player.name, text });
    });

    this.clock.setInterval(() => this.state.setGameResult(), Constants.CHECK_GAME_RESULT_INTERVAL);

    this.setSimulationInterval((deltaTime) => this.loopManager.tick(deltaTime));

    // デバッグ用
    this.onMessage(Constants.NOTIFICATION_TYPE.DEBUG_PLAYER_WIN, (client, data: any) => {
      if (!IS_BACKEND_DEBUG) return;
      for (const [, player] of this.state.players) {
        if (player.sessionId === client.sessionId) continue;
        player.damaged(player.hp);
      }
    });

    this.onMessage(Constants.NOTIFICATION_TYPE.DEBUG_DRAW, (client, data: any) => {
      if (!IS_BACKEND_DEBUG) return;
      for (const [, player] of this.state.players) {
        player.damaged(player.hp);
      }
    });

    this.onMessage(Constants.NOTIFICATION_TYPE.DEBUG_PLAYER_STATUS_MAX, (client, data: any) => {
      if (!IS_BACKEND_DEBUG) return;
      this.state.players.get(client.sessionId)?.debugSetPlayerStatusMax();
    });

    this.onMessage(Constants.NOTIFICATION_TYPE.DEBUG_ALL_PLAYER_STATUS_MAX, (client, data: any) => {
      if (!IS_BACKEND_DEBUG) return;
      for (const [, player] of this.state.players) {
        player.debugSetPlayerStatusMax();
      }
    });

    this.onMessage(Constants.NOTIFICATION_TYPE.DEBUG_DELETE_ALL_BLOCK, (client, data: any) => {
      if (!IS_BACKEND_DEBUG) return;
      this.state.blocks.forEach((block) => {
        block.removedAt = Date.now() + Constants.OBJECT_REMOVAL_DELAY;
        this.state.getBlockToDestroyQueue().enqueue(block);
      });
    });

    this.onMessage(Constants.NOTIFICATION_TYPE.DEBUG_FREEZE_ALL_CPU, (client, data: any) => {
      if (!IS_BACKEND_DEBUG) return;
      this.state.enemies.forEach((enemy) => {
        enemy.debugSetFreeze();
      });
    });

    this.onMessage(Constants.NOTIFICATION_TYPE.DEBUG_UNFREEZE_ALL_CPU, (client, data: any) => {
      if (!IS_BACKEND_DEBUG) return;
      this.state.enemies.forEach((enemy) => {
        enemy.debugSetUnFreeze();
      });
    });
  }

  private async startGame() {
    if (!this.state.gameState.isPlaying()) {
      await this.lock();
      await this.setMetadata({ locked: true });
      this.loopManager.addEnemy();
      this.state.gameState.setPlaying();
      this.state.setTimer();
    }
  }

  onJoin(client: Client, options: { playerName: string }) {
    console.log(client.sessionId, 'joined!');
    const { playerName } = options;
    this.engine.playerService.addPlayer(client.sessionId, playerName);
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.getPlayer(client.sessionId);
    if (player !== undefined) {
      this.state.playerIdxsAvail[player.idx] = true;
    }
    this.engine.playerService.deletePlayer(client.sessionId);
  }

  onDispose() {
    console.log('room', this.roomId, 'disposing...');
  }
}
