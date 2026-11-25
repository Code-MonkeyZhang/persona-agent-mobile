/**
 * @file wsPoseChanged.test.ts
 * @description ws-client 演出事件的分发直测，mock 范式照 wsCompression。
 *   覆盖 pose_changed 的三个参数逐字段透传到注册的 handler，
 *   只带部分参数的载荷原样转交，缺省字段不补值。
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

describe('ws-client 演出事件分发', () => {
  const onPoseChanged = jest.fn();

  beforeEach(() => {
    MockWebSocket.instances = [];
    mockSetStatus.mockClear();
    onPoseChanged.mockClear();
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    wsClient.registerHandler({ onPoseChanged } as unknown as WsEventHandler);
    wsClient.connect('http://host');
    MockWebSocket.instances[0].open();
  });

  afterEach(() => {
    wsClient.disconnect();
    globalThis.WebSocket = undefined as unknown as typeof WebSocket;
  });

  it('pose_changed 的三个参数逐字段透传给 handler', () => {
    MockWebSocket.instances[0].receive({
      type: 'pose_changed',
      sessionId: 'chat-a1',
      pose: '开心',
      motion: 'happy-bounce',
      bubble: 'happy',
    });

    expect(onPoseChanged).toHaveBeenCalledWith(
      'chat-a1',
      '开心',
      'happy-bounce',
      'happy'
    );
  });

  it('只换脸的载荷，动作与气泡按缺省转交', () => {
    MockWebSocket.instances[0].receive({
      type: 'pose_changed',
      sessionId: 'chat-a1',
      pose: '难过',
    });

    expect(onPoseChanged).toHaveBeenCalledWith(
      'chat-a1',
      '难过',
      undefined,
      undefined
    );
  });

  it('只播演出的载荷，立绘按缺省转交', () => {
    MockWebSocket.instances[0].receive({
      type: 'pose_changed',
      sessionId: 'chat-a1',
      motion: 'sad-sink',
      bubble: 'tears',
    });

    expect(onPoseChanged).toHaveBeenCalledWith(
      'chat-a1',
      undefined,
      'sad-sink',
      'tears'
    );
  });
});
