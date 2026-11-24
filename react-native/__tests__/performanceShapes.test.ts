/**
 * @file performanceShapes.test.ts
 * @description 演出协议与名单的编译期锁定，镜像漏抄在这里报出。
 *   pose_changed 事件载荷与 AgentInfo 的两个气泡偏移字段逐字段对齐
 *   shared 的 ws.ts 与 agent.ts 的定义，字段增删改名都会让 keyof
 *   断言或样例赋值在 typecheck 时报错，运行时断言兜底字段真在载荷里。
 *   名单常量再抄一份字面量，权威版本改了名单而镜像没跟上时这里先红。
 *   思考气泡不进 AI 可选名单，由单独的常量登记，是气泡层键集里的第十六个名字。
 */
import type { AgentInfo, ServerMessage } from '../src/api/server-api';
import {
  BUBBLE_CN,
  BUBBLE_NAMES,
  MOTION_CN,
  MOTION_NAMES,
  THINKING_BUBBLE,
  type LayerBubbleName,
} from '../src/lib/performance';

type PoseChangedMsg = Extract<ServerMessage, { type: 'pose_changed' }>;

/** pose_changed 的字段清单，镜像漂移时 keyof 与字面量数组的赋值不再成立 */
const POSE_CHANGED_KEYS: Array<keyof PoseChangedMsg> = [
  'type',
  'sessionId',
  'pose',
  'motion',
  'bubble',
];

/** 样例赋值锁字段类型，缺字段或类型错位在 typecheck 报出 */
const SAMPLE_FULL: PoseChangedMsg = {
  type: 'pose_changed',
  sessionId: 'chat-a1',
  pose: '开心',
  motion: 'angry-stomp',
  bubble: 'angry',
};
const SAMPLE_EFFECT_ONLY: PoseChangedMsg = {
  type: 'pose_changed',
  sessionId: 'chat-a1',
  bubble: 'sigh',
};

/** 枚举值清单，名单镜像与事件载荷的联合必须容纳彼此 */
const MOTIONS: PoseChangedMsg['motion'][] = [...MOTION_NAMES];
const BUBBLES: PoseChangedMsg['bubble'][] = [...BUBBLE_NAMES];

/** AgentInfo 的两个气泡偏移字段存在性，经样例对象锁住 */
const AGENT_OFFSET: Pick<AgentInfo, 'bubbleOffsetX' | 'bubbleOffsetY'> = {
  bubbleOffsetX: -10,
  bubbleOffsetY: 5,
};

/** shared 名单的字面量副本，三个动作气泡相关的常量表都对它负责 */
const SHARED_MOTIONS = [
  'happy-bounce',
  'angry-stomp',
  'heart-beat',
  'sad-sink',
];
const SHARED_BUBBLES = [
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
];

describe('演出协议形状锁定', () => {
  it('pose_changed 字段清单与样例齐备，三个参数都可缺省', () => {
    expect(POSE_CHANGED_KEYS).toHaveLength(5);
    expect(SAMPLE_FULL.motion).toBe('angry-stomp');
    expect(SAMPLE_EFFECT_ONLY).not.toHaveProperty('pose');
    expect(SAMPLE_EFFECT_ONLY).not.toHaveProperty('motion');
  });

  it('事件载荷的联合容纳全部动作与气泡，思考气泡不在名单里', () => {
    expect(MOTIONS).toHaveLength(4);
    expect(BUBBLES).toHaveLength(15);
    expect(BUBBLES).not.toContain('thinking');
    expect(AGENT_OFFSET.bubbleOffsetX).toBe(-10);
  });

  it('名单镜像与 shared 的字面量一致，中文表键集与名单逐一对应', () => {
    expect([...MOTION_NAMES]).toEqual(SHARED_MOTIONS);
    expect([...BUBBLE_NAMES]).toEqual(SHARED_BUBBLES);
    expect(Object.keys(MOTION_CN)).toEqual(SHARED_MOTIONS);
    expect(Object.keys(BUBBLE_CN)).toEqual(SHARED_BUBBLES);
  });

  it('思考气泡由单独的常量登记，气泡层的键集是名单加它', () => {
    expect(THINKING_BUBBLE).toBe('thinking');
    const layerNames: LayerBubbleName[] = [...BUBBLE_NAMES, THINKING_BUBBLE];
    expect(layerNames).toHaveLength(16);
    expect(new Set(layerNames).size).toBe(16);
  });
});
