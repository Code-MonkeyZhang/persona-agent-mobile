/**
 * @file 陪伴演出的动作枚举与气泡名单，react-native 侧的镜像文件。
 *   - 权威版本在 persona-agent dev 的 packages/shared/src/performance.ts，
 *     本文件整块镜像维护，两处改动需同步，这是跨仓纪律
 *   - 移动端不依赖 @persona/shared，服务端专用的 successfulShowPose 不在镜像范围
 *   - 改名单等于改代码，同时改 assets/effects 的素材与 effect-assets 的索引
 */

/** 身体动作的枚举名，命名沿用 LingChat 的构词法 */
export const MOTION_NAMES = [
  'happy-bounce',
  'angry-stomp',
  'heart-beat',
  'sad-sink',
] as const;

export type MotionName = (typeof MOTION_NAMES)[number];

/** 动作的中文观感，参数摘要与一致性测试消费 */
export const MOTION_CN: Record<MotionName, string> = {
  'happy-bounce': '开心弹跳',
  'angry-stomp': '生气跺脚',
  'heart-beat': '心动心跳',
  'sad-sink': '难过下沉',
};

/** AI 可选的情绪气泡名单，英文语义名即参数值，思考气泡不在其中，见 THINKING_BUBBLE */
export const BUBBLE_NAMES = [
  'happy',
  'flutter',
  'tears',
  'angry',
  'doubt',
  'sweat',
  'sigh',
  'shy',
  'surprise',
  'fluster',
  'nervous',
  'embarrassed',
  'notice',
  'chat',
  'angry2',
] as const;

export type BubbleName = (typeof BUBBLE_NAMES)[number];

/** 气泡的中文含义，参数摘要与一致性测试消费 */
export const BUBBLE_CN: Record<BubbleName, string> = {
  happy: '高兴',
  flutter: '心动',
  tears: '流泪',
  angry: '生气',
  doubt: '疑问',
  sweat: '流汗',
  sigh: '叹气',
  shy: '害羞',
  surprise: '惊讶',
  fluster: '慌乱',
  nervous: '紧张',
  embarrassed: '难为情',
  notice: '察觉',
  chat: '聊天',
  angry2: '生气2',
};

/** 思考气泡的名字，不进 AI 可选名单，由客户端的生成相位驱动 */
export const THINKING_BUBBLE = 'thinking';

/** 气泡层能承载的气泡名，情绪气泡或思考气泡，包内资源索引以它为键 */
export type LayerBubbleName = BubbleName | typeof THINKING_BUBBLE;

/**
 * 值是否为合法的动作枚举名
 * @param value 待判定的任意值
 */
export function isMotionName(value: unknown): value is MotionName {
  return (MOTION_NAMES as readonly string[]).includes(value as string);
}

/**
 * 值是否为气泡名单内的名字
 * @param value 待判定的任意值
 */
export function isBubbleName(value: unknown): value is BubbleName {
  return (BUBBLE_NAMES as readonly string[]).includes(value as string);
}

/** 一次 show_pose 演出的三参数，立绘、动作与气泡，三者至少一个 */
export interface ShowPoseParams {
  pose?: string;
  motion?: MotionName;
  bubble?: BubbleName;
}
