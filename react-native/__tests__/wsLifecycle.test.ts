/**
 * @file wsLifecycle.test.ts
 * @description ws-client 生命周期直测，mock 全局 WebSocket 与重依赖模块，
 * 覆盖下行看门狗掐断、保活防掐、旧服务端不武装、重连窗口离线态与稳定期防抖。
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

/** 可控的 WebSocket 替身，测试手动驱动状态迁移 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  /** 测试辅助，模拟网络层完成握手 */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** 测试辅助，模拟服务端下发消息 */
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/** 建立连接并让服务端声明保活节拍 */
function armWatchdog(intervalMs?: number): MockWebSocket {
  const socket = MockWebSocket.instances[0];
  socket.open();
  socket.receive({
    type: 'connected',
    clientId: 'c1',
    keepaliveIntervalMs: intervalMs,
  });
  return socket;
}

describe('ws-client 下行看门狗', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    mockSetStatus.mockClear();
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    wsClient.disconnect();
    globalThis.WebSocket = undefined as unknown as typeof WebSocket;
    jest.useRealTimers();
  });

  it('下行断供超过阈值即掐断并进入重连', () => {
    wsClient.connect('http://host');
    const socket = armWatchdog(5_000);

    jest.advanceTimersByTime(20_000);

    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(mockSetStatus).toHaveBeenCalledWith('reconnecting');
  });

  it('保活持续到达则连接保持', () => {
    wsClient.connect('http://host');
    const socket = armWatchdog(5_000);

    for (let i = 0; i < 6; i++) {
      jest.advanceTimersByTime(5_000);
      socket.receive({ type: 'keepalive' });
    }

    expect(socket.readyState).toBe(MockWebSocket.OPEN);
  });

  it('旧服务端未声明节拍时看门狗保持关闭', () => {
    wsClient.connect('http://host');
    const socket = armWatchdog(undefined);

    jest.advanceTimersByTime(60_000);

    expect(socket.readyState).toBe(MockWebSocket.OPEN);
  });
});

describe('ws-client 重连窗口', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    mockSetStatus.mockClear();
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    wsClient.disconnect();
    globalThis.WebSocket = undefined as unknown as typeof WebSocket;
    jest.useRealTimers();
  });

  it('拨号 15 秒未握手完成即掐断走重连', () => {
    wsClient.connect('http://host');

    jest.advanceTimersByTime(15_000);

    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);
    expect(mockSetStatus).toHaveBeenCalledWith('reconnecting');
  });

  it('窗口耗尽进入离线态并由慢重试接管', () => {
    wsClient.connect('http://host');

    for (
      let i = 0;
      i < 40 && !mockSetStatus.mock.calls.some((call) => call[0] === 'offline');
      i++
    ) {
      MockWebSocket.instances.at(-1)!.close();
      jest.advanceTimersByTime(10_000);
    }

    expect(mockSetStatus).toHaveBeenCalledWith('offline');

    // 65 秒窗口内慢重试只拨一次号，状态不再翻重连中
    const before = MockWebSocket.instances.length;
    jest.advanceTimersByTime(65_000);
    expect(MockWebSocket.instances).toHaveLength(before + 1);
    expect(mockSetStatus.mock.calls.at(-1)).toEqual(['offline']);
  });

  it('短命连接不重置窗口 半死循环收束进离线态', () => {
    wsClient.connect('http://host');

    // 半死服务端连上即掐，稳定期防抖让窗口照常走满并收束进离线态
    for (
      let i = 0;
      i < 40 && !mockSetStatus.mock.calls.some((call) => call[0] === 'offline');
      i++
    ) {
      MockWebSocket.instances.at(-1)!.open();
      MockWebSocket.instances.at(-1)!.close();
      jest.advanceTimersByTime(10_000);
    }

    expect(mockSetStatus).toHaveBeenCalledWith('offline');
  });
});
