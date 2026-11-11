/**
 * @file imageCacheRouter.test.ts
 * @description 附件缓存路由单例直测，假 ImageCache 与假 RNFS，
 *   覆盖未指派空转、按当前主机派发、实例复用与忘掉设备丢弃实例。
 */
import { imageCache } from '../src/storage/image-cache-rn.ts';
import { useDeviceStore } from '../src/stores/deviceStore.ts';

/** 假实例类，记录构造目录与各入口调用 */
const mockFakeCacheImpl = class FakeCache {
  static created: InstanceType<typeof mockFakeCacheImpl>[] = [];
  constructor(readonly cacheDir: string) {
    mockFakeCacheImpl.created.push(this as InstanceType<
      typeof mockFakeCacheImpl
    >);
  }
  peek = jest.fn(() => 'hit');
  resolve = jest.fn(() => Promise.resolve('hit'));
  seed = jest.fn(() => Promise.resolve('hit'));
  clearFailure = jest.fn();
  warmup = jest.fn(() => Promise.resolve());
};

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => 'test-id' }));
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString(): undefined {
      return undefined;
    }
    set(): void {}
    delete(): void {}
    getAllKeys(): string[] {
      return [];
    }
    contains(): boolean {
      return false;
    }
  },
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/docs',
  mkdir: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  unlink: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  copyFile: jest.fn(() => Promise.resolve()),
  hash: jest.fn(() => Promise.resolve('h')),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve() })),
}));

jest.mock('../src/storage/image-cache.ts', () => ({
  ImageCache: jest.fn((dir: string) => new mockFakeCacheImpl(dir)),
}));

const setHost = (hostId: string): void => {
  useDeviceStore.setState({ currentHostId: hostId });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFakeCacheImpl.created = [];
  setHost('');
});

describe('附件缓存路由单例', () => {
  it('主机未指派时全部入口空转', async () => {
    expect(imageCache.peek('src')).toBeNull();
    await expect(imageCache.resolve('src')).resolves.toBeNull();
    await expect(imageCache.seed('h', 'uri', 'image/png')).resolves.toBeNull();
    expect(mockFakeCacheImpl.created).toHaveLength(0);
  });

  it('按当前主机派发并复用同一实例', async () => {
    setHost('host-a');
    expect(imageCache.peek('src')).toBe('hit');
    await imageCache.resolve('src');
    imageCache.clearFailure('src');
    await imageCache.warmup();

    const instance = mockFakeCacheImpl.created[0];
    expect(instance.cacheDir).toBe('/tmp/docs/cache/host-a/attachments');
    expect(instance.peek).toHaveBeenCalledWith('src');
    expect(instance.resolve).toHaveBeenCalledWith('src');
    expect(instance.clearFailure).toHaveBeenCalledWith('src');
    expect(instance.warmup).toHaveBeenCalled();
    expect(mockFakeCacheImpl.created).toHaveLength(1);
  });

  it('切主机后派发给新实例，忘掉设备丢弃实例', async () => {
    setHost('host-c');
    await imageCache.warmup();
    setHost('host-d');
    await imageCache.warmup();
    expect(mockFakeCacheImpl.created).toHaveLength(2);
    expect(mockFakeCacheImpl.created[1].cacheDir).toBe(
      '/tmp/docs/cache/host-d/attachments'
    );

    imageCache.forget('host-d');
    setHost('host-c');
    await imageCache.warmup();
    expect(mockFakeCacheImpl.created).toHaveLength(2);
    setHost('host-d');
    await imageCache.warmup();
    expect(mockFakeCacheImpl.created).toHaveLength(3);
  });
});
