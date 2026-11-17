/**
 * @file cacheLayout.test.ts
 * @description 设备缓存目录布局直测，假 op-sqlite 与假 RNFS，
 *   覆盖路径构造、旧镜像库文件族迁移的三个分支与设备目录删除。
 */
import { open } from '@op-engineering/op-sqlite';
import RNFS from 'react-native-fs';
import {
  attachmentsDirFor,
  deviceDirFor,
  mirrorOpenParams,
  mirrorPathFor,
  migrateLegacyMirror,
  removeDeviceDir,
  removeLegacyImageCacheDir,
} from '../src/storage/cache-layout';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));

/** 假文件系统的存在集合，工厂内经闭包共享 */
const mockPaths = new Set<string>();

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/docs',
  mkdir: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  unlink: jest.fn((p: string) => {
    mockPaths.delete(p);
    return Promise.resolve();
  }),
  moveFile: jest.fn(() => Promise.resolve()),
  exists: jest.fn((p: string) => Promise.resolve(mockPaths.has(p))),
  stat: jest.fn(() => Promise.resolve({ size: 1 })),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve() })),
}));

/** 本轮日志收集 */
let logs: string[];

beforeEach(() => {
  jest.clearAllMocks();
  mockPaths.clear();
  logs = [];
  (open as unknown as jest.Mock).mockImplementation(
    ({ name }: { name: string }) => ({
      getDbPath: () => `/docs/${name}`,
      close: jest.fn(),
    })
  );
});

describe('路径构造', () => {
  it('设备目录、镜像库与附件分区层层归位', () => {
    expect(deviceDirFor('host-a')).toBe('/tmp/docs/cache/host-a');
    expect(mirrorPathFor('host-a')).toBe('/tmp/docs/cache/host-a/mirror.db');
    expect(attachmentsDirFor('host-a')).toBe(
      '/tmp/docs/cache/host-a/attachments'
    );
    expect(mirrorOpenParams('host-a')).toEqual({
      name: 'mirror.db',
      location: '/tmp/docs/cache/host-a',
    });
  });
});

describe('旧镜像库迁移', () => {
  it('有真身且目标缺席时连同伴生迁进设备目录，主文件最后落位', async () => {
    mockPaths.add('/docs/persona-cache-host-a');
    mockPaths.add('/docs/persona-cache-host-a-wal');
    mockPaths.add('/docs/persona-cache-host-a-shm');

    await migrateLegacyMirror('host-a', (m) => logs.push(m));

    const target = '/tmp/docs/cache/host-a/mirror.db';
    const calls = (RNFS.moveFile as jest.Mock).mock.calls.map(
      (c) => `${c[0]} -> ${c[1]}`
    );
    expect(calls).toEqual([
      '/docs/persona-cache-host-a-wal -> ' + target + '-wal',
      '/docs/persona-cache-host-a-shm -> ' + target + '-shm',
      '/docs/persona-cache-host-a -> ' + target,
    ]);
    expect(logs.some((m) => m.includes('migrated'))).toBe(true);
  });

  it('探测产生的零字节空文件直接清理不迁移', async () => {
    (RNFS.stat as unknown as jest.Mock).mockResolvedValueOnce({ size: 0 });
    mockPaths.add('/docs/persona-cache-host-a');

    await migrateLegacyMirror('host-a', (m) => logs.push(m));

    expect(RNFS.moveFile).not.toHaveBeenCalled();
    expect(RNFS.unlink).toHaveBeenCalledWith('/docs/persona-cache-host-a');
  });

  it('目标已在时旧文件按残留清理', async () => {
    mockPaths.add('/docs/persona-cache-host-a');
    mockPaths.add('/tmp/docs/cache/host-a/mirror.db');

    await migrateLegacyMirror('host-a', (m) => logs.push(m));

    expect(RNFS.moveFile).not.toHaveBeenCalled();
    expect(RNFS.unlink).toHaveBeenCalledWith('/docs/persona-cache-host-a');
    expect(logs.some((m) => m.includes('orphan'))).toBe(true);
  });
});

describe('设备目录删除', () => {
  it('忘掉设备即删整个设备目录', async () => {
    mockPaths.add('/tmp/docs/cache/host-a');

    await removeDeviceDir('host-a');

    expect(RNFS.unlink).toHaveBeenCalledWith('/tmp/docs/cache/host-a');
  });

  it('旧图片缓存目录存在时整体废弃', async () => {
    mockPaths.add('/tmp/docs/image-cache');

    await removeLegacyImageCacheDir();

    expect(RNFS.unlink).toHaveBeenCalledWith('/tmp/docs/image-cache');
  });

  it('旧图片缓存目录不存在时静默跳过', async () => {
    await removeLegacyImageCacheDir();

    expect(RNFS.unlink).not.toHaveBeenCalled();
  });
});
