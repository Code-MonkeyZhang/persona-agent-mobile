/**
 * @file compressionShapes.test.ts
 * @description 压缩与占用协议形状的编译期锁定，镜像漏抄在这里报出。
 *   四个 ws 事件载荷与 SessionMeta 新字段与三个持久形状逐字段对齐
 *   shared 的 ws.ts 与 session.ts 的定义，字段增删改名都会让 keyof
 *   断言或样例赋值在 typecheck 时报错，运行时断言兜底字段真在载荷里。
 */
import type { ServerMessage } from '../src/api/server-api';
import type {
  BreakdownShares,
  UsageState,
  CompressionRecord,
  SessionMeta,
} from '../src/storage/sync-shapes';

type ContextUsageMsg = Extract<ServerMessage, { type: 'context_usage' }>;
type CompressionStartedMsg = Extract<
  ServerMessage,
  { type: 'compression_started' }
>;
type CompressionCompleteMsg = Extract<
  ServerMessage,
  { type: 'compression_complete' }
>;
type CompressionFailedMsg = Extract<
  ServerMessage,
  { type: 'compression_failed' }
>;

/** 四事件的字段清单，镜像漂移时 keyof 与字面量数组的赋值不再成立 */
const CONTEXT_USAGE_KEYS: Array<keyof ContextUsageMsg> = [
  'type',
  'sessionId',
  'used',
  'window',
  'shares',
  'source',
];
const COMPRESSION_STARTED_KEYS: Array<keyof CompressionStartedMsg> = [
  'type',
  'sessionId',
  'recordId',
  'attempt',
  'before',
];
const COMPRESSION_COMPLETE_KEYS: Array<keyof CompressionCompleteMsg> = [
  'type',
  'sessionId',
  'recordId',
  'before',
  'after',
  'trigger',
];
const COMPRESSION_FAILED_KEYS: Array<keyof CompressionFailedMsg> = [
  'type',
  'sessionId',
  'recordId',
  'reason',
];

/** 样例赋值锁字段类型，缺字段或类型错位在 typecheck 报出 */
const SAMPLE_CONTEXT_USAGE: ContextUsageMsg = {
  type: 'context_usage',
  sessionId: 'chat-a1',
  used: 79400,
  window: 128000,
  shares: { messages: 60000, systemPersona: 12000, toolsSkills: 7400 },
  source: 'model',
};
const SAMPLE_STARTED: CompressionStartedMsg = {
  type: 'compression_started',
  sessionId: 'chat-a1',
  recordId: 'r1',
  attempt: 1,
  before: null,
};
const SAMPLE_COMPLETE: CompressionCompleteMsg = {
  type: 'compression_complete',
  sessionId: 'chat-a1',
  recordId: 'r1',
  before: 79400,
  after: 33000,
  trigger: 'auto',
};
const SAMPLE_FAILED: CompressionFailedMsg = {
  type: 'compression_failed',
  sessionId: 'chat-a1',
  recordId: 'r1',
  reason: 'provider',
};

/** 枚举值清单，来源与触发与原因的联合漂移时赋值不再成立 */
const USAGE_SOURCES: ContextUsageMsg['source'][] = [
  'model',
  'compression',
  'estimate',
];
const COMPRESSION_TRIGGERS: CompressionCompleteMsg['trigger'][] = [
  'auto',
  'manual',
];
const COMPRESSION_REASONS: CompressionFailedMsg['reason'][] = [
  'no_material',
  'provider',
  'bad_summary',
  'interrupted',
];

/** 三个持久形状的字段清单，随 meta 镜像的漂移在这里报出 */
const BREAKDOWN_KEYS: Array<keyof BreakdownShares> = [
  'messages',
  'systemPersona',
  'toolsSkills',
];
const USAGE_STATE_KEYS: Array<keyof UsageState> = [
  'base',
  'anchorSeq',
  'netAdjust',
  'shares',
  'assemblyTokens',
];
const COMPRESSION_RECORD_KEYS: Array<keyof CompressionRecord> = [
  'id',
  'state',
  'trigger',
  'attempt',
  'before',
  'after',
  'reason',
  'summary',
  'at',
];

/** SessionMeta 的压缩与占用字段存在性，可选字段经样例对象锁住 */
const META_WITH_COMPRESSION: Pick<
  SessionMeta,
  'usageState' | 'compressionLog'
> = {
  usageState: {
    base: 79400,
    anchorSeq: 12,
    netAdjust: 0,
    shares: { messages: 60000, systemPersona: 12000, toolsSkills: 7400 },
    assemblyTokens: 19400,
  },
  compressionLog: [
    {
      id: 'r1',
      state: 'complete',
      trigger: 'auto',
      attempt: 1,
      before: 79400,
      after: 33000,
      at: 1760000000000,
    },
  ],
};

describe('压缩与占用协议形状锁定', () => {
  it('四事件字段清单与样例齐备', () => {
    expect(CONTEXT_USAGE_KEYS).toHaveLength(6);
    expect(COMPRESSION_STARTED_KEYS).toHaveLength(5);
    expect(COMPRESSION_COMPLETE_KEYS).toHaveLength(6);
    expect(COMPRESSION_FAILED_KEYS).toHaveLength(4);
    expect(SAMPLE_CONTEXT_USAGE.shares).not.toBeNull();
    expect(SAMPLE_STARTED.before).toBeNull();
    expect(SAMPLE_COMPLETE.trigger).toBe('auto');
    expect(SAMPLE_FAILED.reason).toBe('provider');
  });

  it('枚举联合完整', () => {
    expect(USAGE_SOURCES).toHaveLength(3);
    expect(COMPRESSION_TRIGGERS).toHaveLength(2);
    expect(COMPRESSION_REASONS).toHaveLength(4);
  });

  it('持久形状字段与 meta 新字段齐备', () => {
    expect(BREAKDOWN_KEYS).toHaveLength(3);
    expect(USAGE_STATE_KEYS).toHaveLength(5);
    expect(COMPRESSION_RECORD_KEYS).toHaveLength(9);
    expect(META_WITH_COMPRESSION.compressionLog).toHaveLength(1);
    expect(META_WITH_COMPRESSION.usageState?.base).toBe(79400);
  });
});
