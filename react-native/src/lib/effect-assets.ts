/**
 * @file 气泡的包内资源索引
 * 素材随 App 包进设备，出泡按名直取零网络，首装离线也能出泡
 * 情绪气泡的键集与 lib/performance 的 BUBBLE_NAMES 一致，思考气泡单独一个键，Record 的类型与一致性测试双重锁定
 */
import type { LayerBubbleName } from './performance';
import angry from '../../assets/effects/angry.webp';
import angry2 from '../../assets/effects/angry2.webp';
import chat from '../../assets/effects/chat.webp';
import doubt from '../../assets/effects/doubt.webp';
import embarrassed from '../../assets/effects/embarrassed.webp';
import fluster from '../../assets/effects/fluster.webp';
import flutter from '../../assets/effects/flutter.webp';
import happy from '../../assets/effects/happy.webp';
import nervous from '../../assets/effects/nervous.webp';
import notice from '../../assets/effects/notice.webp';
import shy from '../../assets/effects/shy.webp';
import sigh from '../../assets/effects/sigh.webp';
import surprise from '../../assets/effects/surprise.webp';
import sweat from '../../assets/effects/sweat.webp';
import tears from '../../assets/effects/tears.webp';
import thinking from '../../assets/effects/thinking.webp';

export const EFFECT_ASSETS: Record<LayerBubbleName, number> = {
  happy,
  flutter,
  tears,
  angry,
  doubt,
  sweat,
  sigh,
  shy,
  surprise,
  fluster,
  nervous,
  embarrassed,
  notice,
  chat,
  angry2,
  thinking,
};
