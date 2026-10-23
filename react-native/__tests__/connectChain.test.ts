/**
 * @file connectChain.test.ts
 * @description 连接链的直测，ws-client、连接服务、握手、镜像库全部 mock，
 *   覆盖新主机落位、握手失败保留现场、身份不符不落写、删除当前主机接替切换、
 *   点当前主机刷新重建与切换全程全局状态静止。
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
    pendingHostId: '',
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
  });

  it('握手失败停在地址无效，不建条目不建链', async () => {
    handshake.mockRejectedValue(new Error('Network error'));

    const ok = await useConnectionStore
      .getState()
      .connectByAddress('https://a');

    expect(ok).toBe(false);
    expect(useConnectionStore.getState().status).toBe('address_invalid');
    expect(useDeviceStore.getState().devices).toHaveLength(0);
    expect(wsConnect).not.toHaveBeenCalled();
  });

  it('切换时身份不符保留旧现场且不落写', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    // 目标条目的地址背后站着别的主机
    handshake.mockResolvedValue({
      hostId: 'host-x',
      hostName: 'Host X',
      version: '1.13.0',
    });

    await useConnectionStore.getState().switchDevice('host-b');

    expect(useConnectionStore.getState().status).toBe('connected');
    expect(useConnectionStore.getState().error).toBe('');
    expect(useDeviceStore.getState().currentHostId).toBe('host-a');
    expect(useDeviceStore.getState().devices[1].address).toBe('https://b');
    expect(useConnectionStore.getState().probes['host-b']).toBe(false);
    expect(switchHost).not.toHaveBeenCalled();
    expect(wsConnect).not.toHaveBeenCalled();
    // 身份不符核身一次失败补查一次，全程不落任何写
    expect(handshake).toHaveBeenCalledTimes(2);
  });

  it('切换网络失败保留旧现场并补查目标', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    handshake.mockRejectedValue(new Error('Network error'));
    // 订阅全程盯住全局状态，切换链不允许它离开 connected
    const seen: string[] = [useConnectionStore.getState().status];
    const unsubscribe = useConnectionStore.subscribe((state) => {
      if (state.status !== seen[seen.length - 1]) {
        seen.push(state.status);
      }
    });

    await useConnectionStore.getState().switchDevice('host-b');

    unsubscribe();
    expect(seen).toEqual(['connected']);
    // 旧链路未动，全局状态与错误文案全程静止，只有目标条目按探测结论标红
    expect(useConnectionStore.getState().status).toBe('connected');
    expect(useConnectionStore.getState().error).toBe('');
    expect(useConnectionStore.getState().pendingHostId).toBe('');
    expect(useDeviceStore.getState().currentHostId).toBe('host-a');
    expect(useConnectionStore.getState().probes['host-b']).toBe(false);
    expect(switchHost).not.toHaveBeenCalled();
    expect(wsConnect).not.toHaveBeenCalled();
    // 核身一次失败补查一次
    expect(handshake).toHaveBeenCalledTimes(2);
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
    expect(useConnectionStore.getState().pendingHostId).toBe('');
    expect(useDeviceStore.getState().currentHostId).toBe('host-a');
    // 刷新失败不补查，探测结论表保持原样
    expect(useConnectionStore.getState().probes['host-a']).toBeUndefined();
  });

  it('刷新在途时忽略新的点击', async () => {
    seedTwoHosts();
    useConnectionStore.setState({ status: 'connected' });
    let release: (info: unknown) => void = () => undefined;
    handshake.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const refresh = useConnectionStore.getState().switchDevice('host-a');
    expect(useConnectionStore.getState().pendingHostId).toBe('host-a');

    await useConnectionStore.getState().switchDevice('host-b');
    expect(handshake).toHaveBeenCalledTimes(1);

    release({ hostId: 'host-a', hostName: 'Host A', version: '1.13.0' });
    await refresh;
    expect(useDeviceStore.getState().currentHostId).toBe('host-a');
    expect(useConnectionStore.getState().pendingHostId).toBe('');
  });

  it('切换在途时忽略新的切换目标', async () => {
    seedTwoHosts();
    let release: (info: unknown) => void = () => undefined;
    handshake.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const first = useConnectionStore.getState().switchDevice('host-b');
    expect(useConnectionStore.getState().pendingHostId).toBe('host-b');

    await useConnectionStore.getState().switchDevice('host-c');
    expect(handshake).toHaveBeenCalledTimes(1);

    release({ hostId: 'host-b', hostName: 'Host B', version: '1.13.0' });
    await first;
    expect(useDeviceStore.getState().currentHostId).toBe('host-b');
    expect(useConnectionStore.getState().pendingHostId).toBe('');
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
