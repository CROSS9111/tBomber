/* eslint-disable @typescript-eslint/restrict-template-expressions */
import * as Config from '../config/config';
import * as Constants from '@server/constants/constants';
import Network, { IChatMessage, IGameStartInfo } from '../services/Network';
import {
  createButton,
  createButtons,
  createDialog,
  createGridTable,
  flipPlayerCard,
} from '../utils/ui';
import ServerPlayer from '@server/rooms/schema/Player';
import GridTable from 'phaser3-rex-plugins/templates/ui/gridtable/GridTable';
import Dialog from 'phaser3-rex-plugins/templates/ui/dialog/Dialog';
import GridSizer from 'phaser3-rex-plugins/templates/ui/gridsizer/GridSizer';
import Label from 'phaser3-rex-plugins/templates/ui/label/Label';
import ContainerLite from 'phaser3-rex-plugins/plugins/containerlite';
import Buttons from 'phaser3-rex-plugins/templates/ui/buttons/Buttons';
import { isPlay } from '../utils/sound';
import { addBackground } from '../utils/title';

export interface IAvailableRoom {
  id: string;
  name: string;
  clients: number;
  maxClients: number;
}

export default class Lobby extends Phaser.Scene {
  network!: Network;
  private bgm?: Phaser.Sound.BaseSound;
  private se1?: Phaser.Sound.BaseSound;
  private se2?: Phaser.Sound.BaseSound;
  private availableRooms!: IAvailableRoom[];
  private buttons?: Buttons;
  private gridTable?: GridTable;
  private dialog?: Dialog;
  private playerName = '';

  // キャラクター選択関連
  private myCharIdx = 0;
  private myPlayerCard?: Label;
  private charSelectBtns: Phaser.GameObjects.Text[] = [];

  // チャット関連
  private chatObjects: Phaser.GameObjects.GameObject[] = [];
  private chatMessages: IChatMessage[] = [];
  private chatLogText?: Phaser.GameObjects.Text;
  private chatInputText?: Phaser.GameObjects.Text;
  private chatInputBg?: Phaser.GameObjects.Graphics;
  private chatInputZone?: Phaser.GameObjects.Zone;
  private chatInputActive = false;
  private chatInputValue = '';
  private chatCursorTimer?: Phaser.Time.TimerEvent;
  private chatCursorVisible = false;
  private chatLayout = { IL: 0, IW: 0, IY: 0, IH: 26 };

  // off() で正確に取り除けるようクラスプロパティとして宣言
  private readonly handleChatKeydown = (event: KeyboardEvent): void => {
    if (!this.chatInputActive) return;
    if (event.key === 'Enter') {
      this.submitChatInput();
    } else if (event.key === 'Backspace') {
      this.chatInputValue = this.chatInputValue.slice(0, -1);
      this.refreshInputDisplay();
    } else if (event.key.length === 1 && this.chatInputValue.length < 60) {
      this.chatInputValue += event.key;
      this.refreshInputDisplay();
    }
  };

  private readonly handleGlobalPointerDown = (
    _p: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
  ): void => {
    if (this.chatInputZone && !gameObjects.includes(this.chatInputZone)) {
      this.deactivateChatInput();
    }
  };

  constructor() {
    super(Config.SCENE_NAME_LOBBY);
  }

  init() {
    this.availableRooms = [];
    this.buttons = undefined;
    this.gridTable = undefined;
    this.dialog = undefined;
    this.destroyCharSelectBtns();
    this.myCharIdx = 0;
    this.chatCursorTimer?.remove();
    this.chatCursorTimer = undefined;
    this.chatObjects.forEach((o) => o.destroy());
    this.chatObjects = [];
    this.chatMessages = [];
    this.chatInputActive = false;
    this.chatInputValue = '';

    this.bgm = this.sound.add('opening', {
      volume: Config.SOUND_VOLUME,
    });

    this.se1 = this.sound.add('select', {
      volume: Config.SOUND_VOLUME,
    });
    this.se2 = this.sound.add('select1', {
      volume: Config.SOUND_VOLUME,
    });
  }

  create(data: { network: Network; playerName: string; bgm: Phaser.Sound.BaseSound | undefined }) {
    if (data.network === undefined) {
      throw new Error('server instance missing');
    } else {
      this.network = data.network;
    }

    if (data.bgm === undefined) {
      this.bgm?.play();
    } else {
      this.bgm = data.bgm;
    }

    addBackground(this);
    this.playerName = data.playerName;
    this.add.volumeIcon(this, Constants.WIDTH - 100, 10, isPlay());

    this.availableRooms = this.getAvailableRooms();
    this.network.onRoomsUpdated(this.handleRoomsUpdated, this);
    this.network.onGameStartInfo(async (data: IGameStartInfo) => {
      await this.handleGameStart(data);
    });
    this.network.onMyPlayerJoinedRoom((players) => {
      players.forEach((player, sessionId) => {
        if (sessionId === this.network.mySessionId) {
          this.addMyPlayerCard(player);
        } else {
          this.addOtherPlayerCard(player);
        }
      });
    });
    this.network.onPlayerJoinedRoom(this.addOtherPlayerCard, this);
    this.network.onPlayerLeftRoom(this.removePlayerCard, this);
    this.network.onPlayerIsReady((player) => {
      this.handlePlayerIsReady(player);
    });

    this.network.onChatMessage((data) => {
      if (this.chatObjects.length === 0) return;
      this.chatMessages.push(data);
      this.updateChatLog();
    });

    this.network.onPlayerCharacterChanged((sessionId, character) => {
      this.updateOtherPlayerSprite(sessionId, character);
    });

    this.buttons = createButtons(this, Constants.WIDTH / 2, Constants.HEIGHT / 5, [
      createButton(this, 'create room', Constants.LIGHT_RED),
    ]);
    this.buttons.on('button.click', this.handleRoomCreate, this);

    this.gridTable = createGridTable(this, this.availableRooms);
    this.gridTable.on('cell.click', this.handleRoomJoin, this);
  }

  private getAvailableRooms() {
    const availableRooms: IAvailableRoom[] = [];
    for (const room of this.network.allRooms) {
      if (room.metadata?.locked === false) {
        availableRooms.push({
          id: room.roomId,
          name: room.metadata?.name,
          clients: room.clients,
          maxClients: room.maxClients,
        });
      }
    }
    if (availableRooms.length === 0) {
      availableRooms.push({ name: 'No rooms available', clients: 0, maxClients: 0, id: 'default' });
    }
    return availableRooms;
  }

  private handleRoomsUpdated() {
    this.availableRooms = this.getAvailableRooms();
    if (this.gridTable !== undefined) {
      this.gridTable?.setItems(this.availableRooms);
      this.gridTable?.refresh();
    }
  }

  private async handleRoomCreate() {
    if (this.network.room !== undefined) {
      await this.network.room.leave();
    }
    if (this.dialog === undefined) {
      this.se1?.play();
      this.disableLobbyButtons();
      await this.network.createAndJoinCustomRoom({
        name: this.playerName,
        password: null,
        autoDispose: true,
        playerName: this.playerName,
      });
      this.dialog = createDialog(
        this,
        Constants.WIDTH / 2,
        Constants.HEIGHT / 2,
        () => this.onDialogReady(),
        () => this.onDialogClose(),
      );
      this.createChatPanel();
    }
  }

  private async handleRoomJoin(cellContainer: any, cellIndex: number) {
    if (cellIndex === -1 || cellIndex >= this.availableRooms.length) return;
    if (this.network.room !== undefined) {
      await this.network.room.leave();
    }
    const room = this.availableRooms[cellIndex];
    if (room.id === 'default') return;
    if (this.dialog === undefined) {
      this.se1?.play();
      this.disableLobbyButtons();
      await this.network.joinCustomRoom(room.id, null, this.playerName);
      this.dialog = createDialog(
        this,
        Constants.WIDTH / 2,
        Constants.HEIGHT / 2,
        () => this.onDialogReady(),
        () => this.onDialogClose(),
      );
      this.createChatPanel();
    }
  }

  private async handleGameStart(data: IGameStartInfo) {
    this.destroyCharSelectBtns();
    this.destroyChatPanel();
    // ロビーシーン停止の処理
    this.bgm?.stop();
    this.scene.stop(Config.SCENE_NAME_LOBBY);
    this.network.removeAllEventListeners();
    await this.network.lobby?.leave();

    const { serverTimer } = data;
    this.scene.start(Config.SCENE_NAME_GAME, { network: this.network, serverTimer });
    this.scene.start(Config.SCENE_NAME_GAME_HEADER, { network: this.network, serverTimer });
  }

  private addMyPlayerCard(player: ServerPlayer) {
    if (this.dialog !== undefined) {
      this.se2?.play();
      const dialogContent = this.dialog.getElement('content') as GridSizer;
      const playerCard = dialogContent.getChildren().at(player.idx) as Label;
      playerCard.setText(this.playerName);
      const icon = playerCard.getElement('icon') as ContainerLite;
      icon.getChildren().forEach((child: any, idx) => {
        if (idx === 2) {
          child.setFillStyle(Constants.BLUE);
        }
      });
      this.myPlayerCard = playerCard;
      const charIdx = Constants.CHARACTERS.indexOf(player.character);
      this.myCharIdx = charIdx >= 0 ? charIdx : 0;
      setTimeout(() => {
        flipPlayerCard(this, playerCard, 'back');
        setTimeout(() => {
          this.createCharSelectBtns(playerCard);
        }, 200);
      }, 200);
    }
  }

  private addOtherPlayerCard(player: ServerPlayer) {
    if (this.dialog !== undefined) {
      this.se2?.play();
      const dialogContent = this.dialog.getElement('content') as GridSizer;
      const playerCard = dialogContent.getChildren().at(player.idx) as Label;
      playerCard.setText(player.name);
      const icon = playerCard.getElement('icon') as ContainerLite;
      icon.getChildren().forEach((child: any, idx) => {
        if (idx === 0) {
          if (player.gameState === Constants.PLAYER_GAME_STATE.READY) {
            child.setFillStyle(Constants.GREEN);
          } else {
            child.setFillStyle(Constants.LIGHT_RED);
          }
        } else if (idx === 1) {
          if (player.gameState === Constants.PLAYER_GAME_STATE.READY) {
            child.setText('ready');
          } else {
            child.setText('not ready');
          }
        } else if (idx === 2) {
          child.setFillStyle(Constants.RED);
        } else if (idx === 3) {
          if (player.gameState === Constants.PLAYER_GAME_STATE.READY) {
            child.play(`${player.character}_down`, true);
          } else {
            child.play(`${player.character}_idle_down`, true);
          }
        }
      });
      setTimeout(() => {
        flipPlayerCard(this, playerCard, 'back');
      }, 200);
    }
  }

  private removePlayerCard(player: ServerPlayer) {
    if (this.dialog !== undefined) {
      const dialogContent = this.dialog.getElement('content') as GridSizer;
      const playerCard = dialogContent.getChildren().at(player.idx) as Label;
      const icon = playerCard.getElement('icon') as ContainerLite;
      icon.getChildren().forEach((child: any, idx) => {
        if (idx === 0) {
          child.setFillStyle(Constants.LIGHT_RED);
        } else if (idx === 1) {
          child.setText('not ready');
        }
      });
      this.dialog.layout();
      flipPlayerCard(this, playerCard, 'front');
    }
  }

  private handlePlayerIsReady(player: ServerPlayer) {
    if (this.dialog !== undefined) {
      const dialogContent = this.dialog.getElement('content') as GridSizer;
      const playerCard = dialogContent.getChildren().at(player.idx) as Label;
      const icon = playerCard.getElement('icon') as ContainerLite;
      icon.getChildren().forEach((child: any, idx) => {
        if (idx === 0) {
          child.setFillStyle(Constants.GREEN);
        } else if (idx === 1) {
          child.setText('ready');
        } else if (idx === 3) {
          child.play(`${player.character}_down`, true);
        }
      });
    }
  }

  private onDialogReady() {
    this.se1?.play();
    this.network.sendPlayerGameState(Constants.PLAYER_GAME_STATE.READY);
  }

  private onDialogClose() {
    this.se1?.play();
    this.destroyCharSelectBtns();
    this.destroyChatPanel();
    this.dialog
      ?.scaleDownDestroyPromise(100)
      .then(async () => {
        this.dialog = undefined;
        await this.network.leaveRoom();
        this.enableLobbyButtons();
      })
      .catch((err) => console.error(err));
  }

  private disableLobbyButtons() {
    this.gridTable?.off('cell.click', this.handleRoomJoin, this);
    this.buttons?.setButtonEnable(false);
  }

  private enableLobbyButtons() {
    this.gridTable?.on('cell.click', this.handleRoomJoin, this);
    this.buttons?.setButtonEnable(true);
  }

  // ─── キャラクター選択 ────────────────────────────────────

  private createCharSelectBtns(card: Label): void {
    const bounds = card.getBounds();
    const cy = bounds.centerY;
    const btnStyle = { fontSize: '18px', fontFamily: 'PressStart2P', color: '#ffffff' };

    const leftBtn = this.add
      .text(bounds.left - 18, cy, '<', btnStyle)
      .setOrigin(0.5)
      .setDepth(300)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this.myCharIdx =
          (this.myCharIdx - 1 + Constants.CHARACTERS.length) % Constants.CHARACTERS.length;
        const char = Constants.CHARACTERS[this.myCharIdx];
        this.network.sendCharacterSelect(char);
        this.applyCharacterToCard(card, char, false);
      });

    const rightBtn = this.add
      .text(bounds.right + 18, cy, '>', btnStyle)
      .setOrigin(0.5)
      .setDepth(300)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this.myCharIdx = (this.myCharIdx + 1) % Constants.CHARACTERS.length;
        const char = Constants.CHARACTERS[this.myCharIdx];
        this.network.sendCharacterSelect(char);
        this.applyCharacterToCard(card, char, false);
      });

    this.charSelectBtns = [leftBtn, rightBtn];
  }

  private applyCharacterToCard(card: Label, character: string, ready: boolean): void {
    const icon = card.getElement('icon') as ContainerLite;
    const sprite = icon.getChildren()[3] as Phaser.GameObjects.Sprite;
    const animKey = ready ? `${character}_down` : `${character}_idle_down`;
    sprite.play(animKey, true);
  }

  private destroyCharSelectBtns(): void {
    this.charSelectBtns.forEach((btn) => btn.destroy());
    this.charSelectBtns = [];
    this.myPlayerCard = undefined;
  }

  private updateOtherPlayerSprite(sessionId: string, character: string): void {
    if (!this.dialog) return;
    const player = this.network.room?.state.players.get(sessionId);
    if (!player) return;
    const dialogContent = this.dialog.getElement('content') as GridSizer;
    const playerCard = dialogContent.getChildren().at(player.idx) as Label;
    const isReady = player.gameState === Constants.PLAYER_GAME_STATE.READY;
    this.applyCharacterToCard(playerCard, character, isReady);
  }

  // ─── チャット (Phaser ネイティブ描画) ────────────────────

  private createChatPanel(): void {
    // ダイアログ下端 (HEIGHT/2 + 350) の 7px 下、キャンバス (HEIGHT=896) 内に収める
    const PL = 30;
    const PT = Math.round(Constants.HEIGHT / 2 + 357); // ~805
    const PW = Constants.WIDTH - 60; // 900
    const PH = 83;
    const D = 250;

    // 入力欄レイアウト
    const IL = PL + 12;
    const IW = PW - 12 - 8 - 88 - 12; // 780
    const IY = PT + PH - 36;
    const IH = 26;
    const BL = IL + IW + 8;
    const BW = 88;
    this.chatLayout = { IL, IW, IY, IH };

    // パネル背景
    const bg = this.add.graphics().setDepth(D);
    bg.fillStyle(0x18181b, 0.95);
    bg.fillRoundedRect(PL, PT, PW, PH, 8);
    bg.lineStyle(2, 0x374151, 1);
    bg.strokeRoundedRect(PL, PT, PW, PH, 8);

    // メッセージログ (最大2行)
    this.chatLogText = this.add
      .text(PL + 12, PT + 9, '', {
        fontSize: '8px',
        fontFamily: 'PressStart2P',
        color: '#cbd5e1',
      })
      .setLineSpacing(5)
      .setDepth(D + 1);

    // 入力欄背景
    this.chatInputBg = this.add.graphics().setDepth(D + 1);
    this.redrawInputBorder(false);

    // 入力欄テキスト (打鍵中の文字 + カーソル)
    this.chatInputText = this.add
      .text(IL + 8, IY + IH / 2, 'type a message...', {
        fontSize: '8px',
        fontFamily: 'PressStart2P',
        color: '#6b7280',
      })
      .setOrigin(0, 0.5)
      .setDepth(D + 2);

    // 入力欄クリックゾーン
    this.chatInputZone = this.add
      .zone(IL + IW / 2, IY + IH / 2, IW, IH)
      .setInteractive({ useHandCursor: true })
      .setDepth(D + 2);
    this.chatInputZone.on('pointerdown', () => this.activateChatInput());

    // 送信ボタン
    const sendBg = this.add.graphics().setDepth(D + 1);
    sendBg.fillStyle(0xa3e635, 1);
    sendBg.fillRoundedRect(BL, IY, BW, IH, 4);

    const sendLabel = this.add
      .text(BL + BW / 2, IY + IH / 2, 'send', {
        fontSize: '8px',
        fontFamily: 'PressStart2P',
        color: '#111111',
      })
      .setOrigin(0.5)
      .setDepth(D + 2);

    const sendZone = this.add
      .zone(BL + BW / 2, IY + IH / 2, BW, IH)
      .setInteractive({ useHandCursor: true })
      .setDepth(D + 2);
    sendZone.on('pointerdown', () => this.submitChatInput());

    // 入力欄以外クリックで非アクティブ
    this.input.on('pointerdown', this.handleGlobalPointerDown, this);
    // キーボード入力
    this.input.keyboard?.on('keydown', this.handleChatKeydown, this);
    // カーソル点滅
    this.chatCursorTimer = this.time.addEvent({
      delay: 530,
      loop: true,
      callback: () => {
        this.chatCursorVisible = !this.chatCursorVisible;
        this.refreshInputDisplay();
      },
    });

    this.chatObjects = [
      bg,
      this.chatLogText,
      this.chatInputBg,
      this.chatInputText,
      this.chatInputZone,
      sendBg,
      sendLabel,
      sendZone,
    ];
  }

  private activateChatInput(): void {
    this.chatInputActive = true;
    this.redrawInputBorder(true);
    this.refreshInputDisplay();
  }

  private deactivateChatInput(): void {
    this.chatInputActive = false;
    this.redrawInputBorder(false);
    this.refreshInputDisplay();
  }

  private redrawInputBorder(active: boolean): void {
    if (!this.chatInputBg) return;
    const { IL, IW, IY, IH } = this.chatLayout;
    this.chatInputBg.clear();
    this.chatInputBg.fillStyle(0x1f2937, 1);
    this.chatInputBg.fillRoundedRect(IL, IY, IW, IH, 4);
    this.chatInputBg.lineStyle(1, active ? 0xa3e635 : 0x4b5563, 1);
    this.chatInputBg.strokeRoundedRect(IL, IY, IW, IH, 4);
  }

  private refreshInputDisplay(): void {
    if (!this.chatInputText) return;
    if (!this.chatInputActive && this.chatInputValue.length === 0) {
      this.chatInputText.setText('type a message...').setStyle({ color: '#6b7280' });
      return;
    }
    const cursor = this.chatInputActive && this.chatCursorVisible ? '|' : '';
    this.chatInputText.setText(this.chatInputValue + cursor).setStyle({ color: '#ffffff' });
  }

  private submitChatInput(): void {
    const text = this.chatInputValue.trim();
    if (text) this.network.sendChatMessage(text);
    this.chatInputValue = '';
    this.refreshInputDisplay();
  }

  private destroyChatPanel(): void {
    this.chatCursorTimer?.remove();
    this.chatCursorTimer = undefined;
    this.input.off('pointerdown', this.handleGlobalPointerDown, this);
    this.input.keyboard?.off('keydown', this.handleChatKeydown, this);
    this.chatObjects.forEach((o) => o.destroy());
    this.chatObjects = [];
    this.chatLogText = undefined;
    this.chatInputText = undefined;
    this.chatInputBg = undefined;
    this.chatInputZone = undefined;
    this.chatInputActive = false;
    this.chatInputValue = '';
    this.chatMessages = [];
  }

  private updateChatLog(): void {
    if (!this.chatLogText) return;
    const lines = this.chatMessages
      .slice(-2)
      .map((m) => `${m.playerName}: ${m.text.replace(/[\r\n]/g, '')}`);
    this.chatLogText.setText(lines);
  }
}
