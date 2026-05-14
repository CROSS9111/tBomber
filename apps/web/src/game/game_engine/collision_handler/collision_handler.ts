import * as Constants from '@server/constants/constants';
import { blastToBomb } from '@server/game_engine/collision_handler/blast';
import Bomb from '../../items/Bomb';
import { getGameScene } from '../../utils/globalGame';

export default function collisionHandler(bodyA: MatterJS.BodyType, bodyB: MatterJS.BodyType) {
  /**
   * bodyA <- this のオブジェクト
   * bodyB <- 他 のオブジェクト
   */

  if (bodyA.gameObject == null || bodyB.gameObject == null) return;

  // getData ではなく body.label
  const aType = bodyA.label as Constants.OBJECT_LABELS;
  const bType = bodyB.label as Constants.OBJECT_LABELS;

  // A = PLAYER, B = BLAST
  // サーバで判定するので不要

  // A = BLAST, B = BOMB
  if (aType === Constants.OBJECT_LABEL.BLAST && bType === Constants.OBJECT_LABEL.BOMB) {
    // gameObject は @types/matter-js では any。Bomb の id は private なので
    // 同等のアクセス方法を維持するため any 経由で読み取る。
    const go = bodyB.gameObject as any;
    blastToBomb(go as Bomb, go.id);
  }

  // A = PLAYER, B = ITEM
  // アイテム取得時に音を鳴らす
  if (aType === Constants.OBJECT_LABEL.PLAYER && bType === Constants.OBJECT_LABEL.ITEM) {
    const game = getGameScene();
    if (game == null) return;
    game.getSeItemGet().play();
  }
}
