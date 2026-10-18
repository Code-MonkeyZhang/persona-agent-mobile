/**
 * @file deviceStore.test.ts
 * @description 设备登记仓库的直测，假 MMKV 落内存表，
 *   覆盖身份落位、地址更新保留改名、改名、删条目清当前指向。
 */
import { useDeviceStore } from '../src/stores/deviceStore';
import { loadDeviceRegistry } from '../src/storage/StorageUtils';

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

const mmkvStore = (
  jest.requireMock('react-native-mmkv') as {
    __store: Map<string, string>;
  }
).__store;

const HOST_A = {
  hostId: 'host-a',
  hostName: 'Host A',
  version: 'v1.13.0',
  address: 'https://a',
};
const HOST_B = {
  hostId: 'host-b',
  hostName: 'Host B',
  version: 'v1.12.0',
  address: 'https://b',
};

beforeEach(() => {
  mmkvStore.clear();
  useDeviceStore.setState({ devices: [], currentHostId: '' });
});

describe('设备登记仓库', () => {
  it('未知身份落位时用自称名作标签初始值并指向它', () => {
    useDeviceStore.getState().upsertConnected(HOST_A);

    const state = useDeviceStore.getState();
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]).toMatchObject({
      hostId: 'host-a',
      name: 'Host A',
      address: 'https://a',
      version: 'v1.13.0',
    });
    expect(state.currentHostId).toBe('host-a');
  });

  it('已知身份换地址只更新地址与版本并保留改名', () => {
    useDeviceStore.getState().upsertConnected(HOST_A);
    useDeviceStore.getState().renameDevice('host-a', '家里的台式机');

    useDeviceStore.getState().upsertConnected({
      ...HOST_A,
      address: 'https://a-new',
      version: 'v1.14.0',
    });

    const state = useDeviceStore.getState();
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]).toMatchObject({
      name: '家里的台式机',
      address: 'https://a-new',
      version: 'v1.14.0',
    });
  });

  it('空名条目是没拿到自称名的存量，握手时补上标签初始值', () => {
    useDeviceStore.setState({
      devices: [
        {
          hostId: 'host-a',
          name: '',
          address: 'https://a',
          version: '',
          lastConnectedAt: 0,
        },
      ],
      currentHostId: 'host-a',
    });

    useDeviceStore.getState().upsertConnected(HOST_A);

    expect(useDeviceStore.getState().devices[0].name).toBe('Host A');
  });

  it('改名就地生效并整体持久化', () => {
    useDeviceStore.getState().upsertConnected(HOST_A);
    useDeviceStore.getState().renameDevice('host-a', '工作室电脑');

    expect(useDeviceStore.getState().devices[0].name).toBe('工作室电脑');
    expect(loadDeviceRegistry().devices[0].name).toBe('工作室电脑');
  });

  it('删当前条目清掉当前指向，删别的条目指向不动', () => {
    useDeviceStore.getState().upsertConnected(HOST_A);
    useDeviceStore.getState().upsertConnected(HOST_B);

    useDeviceStore.getState().removeDevice('host-a');
    expect(useDeviceStore.getState().currentHostId).toBe('host-b');

    useDeviceStore.getState().removeDevice('host-b');
    expect(useDeviceStore.getState().currentHostId).toBe('');
    expect(useDeviceStore.getState().devices).toHaveLength(0);
  });

  it('指向只在条目存在时生效', () => {
    useDeviceStore.getState().upsertConnected(HOST_A);
    useDeviceStore.getState().setCurrentHost('host-b');

    expect(useDeviceStore.getState().currentHostId).toBe('host-a');
  });
});
