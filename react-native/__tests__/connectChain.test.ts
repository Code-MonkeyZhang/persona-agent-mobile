/**
 * @file connectChain.test.ts
 * @description 连接链的直测，ws-client、连接服务、握手、镜像库全部 mock，
 *   覆盖新主机落位、握手失败置红条、身份不符落位不回滚、切换先落位后建链、
 *   settle 幂等、删除当前主机接替切换、点当前主机刷新重建与后到意图顶掉在途链。
 */
import { useConnectionStore } from '../src/stores/connectionStore';
import { useDeviceStore } from '../src/stores/deviceStore';
import { connectToServer } from '../src/api/connection-service';
import { fetchHandshakeInfo } from '../src/api/sync-api';
import { cacheDb } from '../src/storage/cache-db';
import * as wsClient from '../src/api/ws-client';

jest.mock('uuid', () => ({ v4: () => 'test-device-id' }));

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    MMKV: class {
      set(key: string, value: string | number | boolean) {
        store.set(key, String(value));
      }
      getString(key: string) {
        return store.get(key);
      }
      getBoolean(key: string) {
        return store.get(key) === 'true';
      }
      delete(key: string) {
        store.delete(key);
      }
    },
    __store: store,
  };
});

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/docs',
  mkdir: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  unlink: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  exists: jest.fn(() => Promise.resolve(false)),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve() })),
}));

jest.mock('../src/api/ws-client', () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
  clearSubscription: jest.fn(),
}));

jest.mock('../src/api/connection-service', () => ({
  connectToServer: jest.fn(),
}));

jest.mock('../src/api/sync-api', () => ({
  fetchHandshakeInfo: jest.fn(),
}));

jest.mock('../src/storage/cache-db', () => ({
  cacheDb: { switchHost: jest.fn(), deleteHostDb: jest.fn() },
}));

jest.mock('../src/stores/sessionStore', () => ({
  useSessionStore: { getState: () => ({ resetForHostSwitch: jest.fn() }) },
}));

jest.mock('../src/stores/chatStore', () => ({
  useChatStore: { getState: () => ({ resetForHostSwitch: jest.fn() }) },
}));

const handshake = fetchHandshakeInfo as jest.Mock;
const pair = connectToServer as jest.Mock;
const switchHost = cacheDb.switchHost as jest.Mock;
const wsConnect = wsClient.connect as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useConnectionStore.setState({
    status: 'idle',
    reconnectVersion: 0,
    serverAddress: '',
    error: '',
    hostVersion: 0,
    probes: {},
    pendingTarget: null,
    settledHostId: '',
  });
  useDeviceStore.setState({ devices: [], currentHostId: '' });
});

/** 造两台已登记设备的清单，当前是 host-a */
function seedTwoHosts(): void {
  useDeviceStore.setState({
    devices: [
      {
        hostId: 'host-a',
        name: 'Host A',
        address: 'https://a',
        version: '1.13.0',
        lastConnectedAt: 1,
      },
      {
        hostId: 'host-b',
        name: 'Host B',
        address: 'https://b',
        version: '1.13.0',
        lastConnectedAt: 1,
      },
    ],
    currentHostId: 'host-a',
  });
}

/** 排空微任务与零毫秒定时器，让挂起的连接链推进到下一个断点 */
function flushChain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('连接链四阶段', () => {
  it('新地址握手成功后落位建条目并接管连接', async () => {
    handshake.mockResolvedValue({
      hostId: 'host-a',
      hostName: 'Host A',
      version: '1.13.0',
    });
    pair.mockResolvedValue({ success: true });

    const ok = await useConnectionStore
      .getState()
      .connectByAddress('https://a');

    expect(ok).toBe(true);
    const state = useDeviceStore.getState();
    expect(state.devices).toHaveLength(1);
    expect(state.currentHostId).toBe('host-a');
    expect(switchHost).toHaveBeenCalledWith('host-a');
    expect(wsConnect).toHaveBeenCalledWith('https://a');
    expect(useConnectionStore.getState().hostVersion).toBe(1);
    expect(useConnectionStore.getState().pendingTarget).toBeNull();
  });

  it('握手失败停在地址无效，不建条目并保留在途目标供占位行重试', async () => {
    handshake.mockRejectedValue(new Error('Network error'));

    const ok = await useConnectionStore
      .getState()
      .connectByAddress('https://a');

    expect(ok).toBe(false);
    expect(useConnectionStore.getState().status).toBe('address_invalid');
    expect(useDeviceStore.getState().devices).toHaveLength(0);
    expect(wsConnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().pendingTarget).toEqual({
      kind: 'address',
      address: 'https://a',
    });
  });

  it('切换时身份不符落位目标镜像并置红条', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    // 目标条目的地址背后站着别的主机
    handshake.mockResolvedValue({
      hostId: 'host-x',
      hostName: 'Host X',
      version: '1.13.0',
    });

    await useConnectionStore.getState().switchDevice('host-b');

    // 落位不因核身失败回滚，界面停留在目标主机的镜像，红条如实报错
    expect(useDeviceStore.getState().currentHostId).toBe('host-b');
    expect(switchHost).toHaveBeenCalledWith('host-b');
    expect(useConnectionStore.getState().status).toBe('address_invalid');
    expect(useConnectionStore.getState().probes['host-b']).toBe(false);
    expect(wsConnect).not.toHaveBeenCalled();
    // 核身一次失败补查一次，全程不建链
    expect(handshake).toHaveBeenCalledTimes(2);
  });

  it('切换网络失败保留落位并置红条补查目标', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    handshake.mockRejectedValue(new Error('Network error'));
    // 订阅盯住状态轨迹，切换链应走出蓝转红的如实序列
    const seen: string[] = [useConnectionStore.getState().status];
    const unsubscribe = useConnectionStore.subscribe((state) => {
      if (state.status !== seen[seen.length - 1]) {
        seen.push(state.status);
      }
    });

    await useConnectionStore.getState().switchDevice('host-b');

    unsubscribe();
    // 落位先行，横幅蓝转红反映目标主机，视图不回滚
    expect(seen).toEqual(['connected', 'connecting', 'address_invalid']);
    expect(useDeviceStore.getState().currentHostId).toBe('host-b');
    expect(switchHost).toHaveBeenCalledWith('host-b');
    expect(useConnectionStore.getState().pendingTarget).toBeNull();
    expect(useConnectionStore.getState().probes['host-b']).toBe(false);
    expect(wsConnect).not.toHaveBeenCalled();
    // 核身一次失败补查一次
    expect(handshake).toHaveBeenCalledTimes(2);
  });

  it('切换成功时落位先于建链，界面重读先于任何推送', async () => {
    seedTwoHosts();
    handshake.mockResolvedValue({
      hostId: 'host-b',
      hostName: 'Host B',
      version: '1.13.0',
    });

    await useConnectionStore.getState().switchDevice('host-b');

    expect(switchHost.mock.invocationCallOrder[0]).toBeLessThan(
      wsConnect.mock.invocationCallOrder[0]
    );
    expect(useConnectionStore.getState().hostVersion).toBe(1);
    expect(useConnectionStore.getState().status).toBe('connecting');
  });

  it('settle 幂等，已落位主机不重切镜像不重复计数', async () => {
    seedTwoHosts();

    await useConnectionStore.getState().settleHost('host-a');
    await useConnectionStore.getState().settleHost('host-a');

    expect(switchHost).toHaveBeenCalledTimes(1);
    expect(useDeviceStore.getState().currentHostId).toBe('host-a');
    expect(useConnectionStore.getState().hostVersion).toBe(1);
  });

  it('点当前主机走刷新链重建连接', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    handshake.mockResolvedValue({
      hostId: 'host-a',
      hostName: 'Host A',
      version: '1.13.0',
    });

    await useConnectionStore.getState().switchDevice('host-a');

    // 刷新是真重连，走冷启动链落位建链，全局状态进入 connecting 等 WS 回填
    expect(handshake).toHaveBeenCalledWith('https://a');
    expect(switchHost).toHaveBeenCalledWith('host-a');
    expect(wsConnect).toHaveBeenCalledWith('https://a');
    expect(useConnectionStore.getState().status).toBe('connecting');
    expect(useConnectionStore.getState().pendingTarget).toBeNull();
    expect(useDeviceStore.getState().currentHostId).toBe('host-a');
    // 刷新失败不补查，探测结论表保持原样
    expect(useConnectionStore.getState().probes['host-a']).toBeUndefined();
  });

  it('刷新在途时新切换顶掉刷新链，旧链恢复后作废', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    /** 挂起的握手断点按创建序收集，释放不依赖微任务交错 */
    const gates: Array<(info: unknown) => void> = [];
    handshake.mockImplementation(
      () => new Promise((resolve) => gates.push(resolve))
    );

    const refresh = useConnectionStore.getState().switchDevice('host-a');
    expect(useConnectionStore.getState().pendingTarget).toEqual({
      kind: 'host',
      hostId: 'host-a',
    });

    // 后到的切换顶掉刷新链，在途目标换人，刷新链的握手结果不再生效
    const switchover = useConnectionStore.getState().switchDevice('host-b');
    expect(useConnectionStore.getState().pendingTarget).toEqual({
      kind: 'host',
      hostId: 'host-b',
    });

    gates[0]({ hostId: 'host-a', hostName: 'Host A', version: '1.13.0' });
    await refresh;
    // 刷新链作废，host-a 没有落位建链
    expect(wsConnect).not.toHaveBeenCalled();

    // 先等切换链推进到它自己的握手断点，再放行
    await flushChain();
    gates[1]({ hostId: 'host-b', hostName: 'Host B', version: '1.13.0' });
    await switchover;
    expect(useDeviceStore.getState().currentHostId).toBe('host-b');
    expect(wsConnect).toHaveBeenCalledWith('https://b');
    expect(useConnectionStore.getState().pendingTarget).toBeNull();
  });

  it('切换在途时扫码顶掉切换，旧链落定作废不建链', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    handshake.mockResolvedValue({
      hostId: 'host-c',
      hostName: 'Host C',
      version: '1.13.0',
    });
    pair.mockResolvedValue({ success: true });
    // 阻塞点挂在切换链的镜像切换上，只挡第一次调用避免实现跨用例残留
    let releaseSettle: () => void = () => undefined;
    switchHost.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSettle = resolve;
        })
    );

    const switchover = useConnectionStore.getState().switchDevice('host-b');
    expect(useConnectionStore.getState().pendingTarget).toEqual({
      kind: 'host',
      hostId: 'host-b',
    });

    // 扫码新地址顶掉切换链，占位行接管进度
    const scan = useConnectionStore.getState().connectByAddress('https://c');
    expect(useConnectionStore.getState().pendingTarget).toEqual({
      kind: 'address',
      address: 'https://c',
    });

    // 先等切换链推进到镜像切换的阻塞点，再放行
    await flushChain();
    releaseSettle();
    await switchover;
    await scan;

    // 切换链放行后世代已过期，不再核身不建链，扫码链落位建链接管
    expect(handshake).toHaveBeenCalledTimes(1);
    const state = useDeviceStore.getState();
    expect(state.devices).toHaveLength(3);
    expect(state.currentHostId).toBe('host-c');
    expect(wsConnect).toHaveBeenCalledWith('https://c');
    expect(useConnectionStore.getState().pendingTarget).toBeNull();
  });

  it('删除当前主机时自动接替余下第一台', async () => {
    seedTwoHosts();
    handshake.mockResolvedValue({
      hostId: 'host-b',
      hostName: 'Host B',
      version: '1.13.0',
    });

    await useConnectionStore.getState().forgetDevice('host-a');

    const state = useDeviceStore.getState();
    expect(state.devices).toHaveLength(1);
    expect(state.currentHostId).toBe('host-b');
    expect(cacheDb.deleteHostDb).toHaveBeenCalledWith('host-a');
    expect(switchHost).toHaveBeenCalledWith('host-b');
    expect(wsConnect).toHaveBeenCalledWith('https://b');
  });

  it('冷启动按登记表当前条目核身连接', async () => {
    useDeviceStore.setState({
      devices: [
        {
          hostId: 'host-a',
          name: 'Host A',
          address: 'https://a',
          version: '1.13.0',
          lastConnectedAt: 1,
        },
      ],
      currentHostId: 'host-a',
    });
    handshake.mockResolvedValue({
      hostId: 'host-a',
      hostName: 'Host A',
      version: '1.13.0',
    });

    await useConnectionStore.getState().coldStart();

    expect(wsConnect).toHaveBeenCalledWith('https://a');
  });
});
