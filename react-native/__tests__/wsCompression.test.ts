/**
 * @file wsCompression.test.ts
 * @description ws-client 压缩与占用四事件的分发直测，mock 范式照 wsLifecycle。
 *   覆盖 context_usage 与 compression 三事件的字段透传到注册的 handler，
 *   断言逐字段比对，镜像漏抄或转发错位在这里报出。
 */
const mockSetStatus = jest.fn();

jest.mock('../src/stores/connectionStore', () => ({
  useConnectionStore: { getState: () => ({ setStatus: mockSetStatus }) },
}));

jest.mock('../src/stores/sessionStore', () => ({
  useSessionStore: { getState: () => ({ updateSessionTitle: jest.fn() }) },
}));

jest.mock('../src/utils/DeviceUtils', () => ({
  getDeviceId: () => 'test-device',
  getCachedDeviceName: () => 'Test Phone',
}));

jest.mock('../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import * as wsClient from '../src/api/ws-client';
import type { WsEventHandler } from '../src/api/ws-client';

/** 可控的 WebSocket 替身，测试手动驱动状态迁移 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  /** 测试辅助，模拟网络层完成握手 */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** 测试辅助，模拟服务端下发消息 */
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('ws-client 压缩与占用事件分发', () => {
  const onContextUsage = jest.fn();
  const onCompressionStarted = jest.fn();
  const onCompressionComplete = jest.fn();
  const onCompressionFailed = jest.fn();

  beforeEach(() => {
    MockWebSocket.instances = [];
    mockSetStatus.mockClear();
    onContextUsage.mockClear();
    onCompressionStarted.mockClear();
    onCompressionComplete.mockClear();
    onCompressionFailed.mockClear();
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    wsClient.registerHandler({
      onContextUsage,
      onCompressionStarted,
      onCompressionComplete,
      onCompressionFailed,
    } as unknown as WsEventHandler);
    wsClient.connect('http://host');
    MockWebSocket.instances[0].open();
  });

  afterEach(() => {
    wsClient.disconnect();
    globalThis.WebSocket = undefined as unknown as typeof WebSocket;
  });

  it('context_usage 逐字段透传给 handler，载荷的 shares 不进快照', () => {
    MockWebSocket.instances[0].receive({
      type: 'context_usage',
      sessionId: 'chat-a1',
      used: 79400,
      window: 128000,
      shares: { messages: 60000, systemPersona: 12000, toolsSkills: 7400 },
      source: 'model',
    });

    expect(onContextUsage).toHaveBeenCalledWith('chat-a1', {
      used: 79400,
      window: 128000,
    });
  });

  it('context_usage 无 shares 的载荷同样透传', () => {
    MockWebSocket.instances[0].receive({
      type: 'context_usage',
      sessionId: 'chat-a1',
      used: 1,
      window: 2,
      shares: null,
      source: 'estimate',
    });

    expect(onContextUsage).toHaveBeenCalledWith('chat-a1', {
      used: 1,
      window: 2,
    });
  });

  it('compression_started 携带 recordId 与 attempt 与 before', () => {
    MockWebSocket.instances[0].receive({
      type: 'compression_started',
      sessionId: 'chat-a1',
      recordId: 'r1',
      attempt: 2,
      before: 79400,
    });

    expect(onCompressionStarted).toHaveBeenCalledWith(
      'chat-a1',
      'r1',
      2,
      79400
    );
  });

  it('compression_started 的 before 可为 null', () => {
    MockWebSocket.instances[0].receive({
      type: 'compression_started',
      sessionId: 'chat-a1',
      recordId: 'r1',
      attempt: 1,
      before: null,
    });

    expect(onCompressionStarted).toHaveBeenCalledWith('chat-a1', 'r1', 1, null);
  });

  it('compression_complete 携带前后分子与触发来源', () => {
    MockWebSocket.instances[0].receive({
      type: 'compression_complete',
      sessionId: 'chat-a1',
      recordId: 'r1',
      before: 79400,
      after: 33000,
      trigger: 'manual',
    });

    expect(onCompressionComplete).toHaveBeenCalledWith(
      'chat-a1',
      'r1',
      79400,
      33000,
      'manual'
    );
  });

  it('compression_failed 携带原因码', () => {
    MockWebSocket.instances[0].receive({
      type: 'compression_failed',
      sessionId: 'chat-a1',
      recordId: 'r1',
      reason: 'no_material',
    });

    expect(onCompressionFailed).toHaveBeenCalledWith(
      'chat-a1',
      'r1',
      'no_material'
    );
  });
});
