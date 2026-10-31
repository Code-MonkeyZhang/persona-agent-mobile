/**
 * @file __tests__/image-cache.test.ts
 * @description 图片缓存核心的单测，依赖注入替身，覆盖键提取、目录扫描命中、
 *   下载校验落盘、哈希不符拒绝、并发合并、并发首访共享扫描、覆盖写清旧、
 *   warmup 预热与临时残留排除等主路径。
 */
import {
  ImageCache,
  parseHashKey,
  type ImageCacheDeps,
} from '../src/storage/image-cache';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const URL_WITH_H = `http://192.168.1.2:3847/api/agents/a1/avatar?h=${KEY}`;
const URL_OTHER = `http://192.168.1.2:3847/api/agents/a2/avatar?h=${OTHER_KEY}`;
const DIR = '/docs/image-cache';

interface CallStats {
  download: string[];
  moveFile: Array<[string, string]>;
  unlink: string[];
}

function makeDeps(
  stats: CallStats,
  overrides: Partial<ImageCacheDeps> = {}
): ImageCacheDeps {
  return {
    mkdir: async () => {},
    readDir: async () => [],
    unlink: async (path) => {
      stats.unlink.push(path);
    },
    moveFile: async (from, to) => {
      stats.moveFile.push([from, to]);
    },
    sha256: async () => KEY,
    download: async (url) => {
      stats.download.push(url);
      return { statusCode: 200, contentType: 'image/png' };
    },
    log: () => {},
    ...overrides,
  };
}

test('parseHashKey 只认 64 位十六进制的 h 参数', () => {
  expect(parseHashKey(URL_WITH_H)).toBe(KEY);
  expect(parseHashKey(`http://x/api?h=${OTHER_KEY}&size=lg`)).toBe(OTHER_KEY);
  expect(parseHashKey('http://x/api?size=lg')).toBeNull();
  expect(parseHashKey('http://x/api')).toBeNull();
  expect(parseHashKey('http://x/api?h=3f8a2b')).toBeNull();
  expect(parseHashKey(`http://x/api?h=${'G'.repeat(64)}`)).toBeNull();
});

test('resolve 无 h 参数时直接返回 null 不触任何文件操作', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const cache = new ImageCache(DIR, makeDeps(stats));
  expect(await cache.resolve('http://x/api/agents/a1/avatar')).toBeNull();
  expect(stats.download.length).toBe(0);
});

test('目录扫描命中已有文件时不发起下载', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const deps = makeDeps(stats, {
    readDir: async () => [`${KEY}.png`, 'not-a-hash.txt'],
  });
  const cache = new ImageCache(DIR, deps);
  expect(await cache.resolve(URL_WITH_H)).toBe(`${DIR}/${KEY}.png`);
  expect(stats.download.length).toBe(0);
  expect(cache.peek(URL_WITH_H)).toBe(`${DIR}/${KEY}.png`);
});

test('未命中路径下载校验落盘并按内容类型取扩展名', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const cache = new ImageCache(DIR, makeDeps(stats));
  const path = await cache.resolve(URL_WITH_H);
  expect(stats.download).toEqual([URL_WITH_H]);
  expect(stats.moveFile).toEqual([
    [`${DIR}/${KEY}.download`, `${DIR}/${KEY}.png`],
  ]);
  expect(path).toBe(`${DIR}/${KEY}.png`);
});

test('哈希不符拒绝落盘并记住失败，不反复下载', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const cache = new ImageCache(
    DIR,
    makeDeps(stats, { sha256: async () => OTHER_KEY })
  );
  expect(await cache.resolve(URL_WITH_H)).toBeNull();
  expect(stats.moveFile.length).toBe(0);
  expect(stats.unlink).toEqual([`${DIR}/${KEY}.download`]);
  expect(await cache.resolve(URL_WITH_H)).toBeNull();
  expect(stats.download.length).toBe(1);
});

test('同键并发请求共享一次下载', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deps = makeDeps(stats, {
    download: async (url) => {
      stats.download.push(url);
      await gate;
      return { statusCode: 200, contentType: 'image/jpeg' };
    },
  });
  const cache = new ImageCache(DIR, deps);
  const first = cache.resolve(URL_WITH_H);
  const second = cache.resolve(URL_WITH_H);
  release();
  expect(await first).toBe(`${DIR}/${KEY}.jpg`);
  expect(await second).toBe(`${DIR}/${KEY}.jpg`);
  expect(stats.download.length).toBe(1);
});

test('非 2xx 下载失败清理临时文件并返回 null', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const cache = new ImageCache(
    DIR,
    makeDeps(stats, {
      download: async () => ({ statusCode: 404, contentType: undefined }),
    })
  );
  expect(await cache.resolve(URL_WITH_H)).toBeNull();
  expect(stats.moveFile.length).toBe(0);
  expect(stats.unlink).toEqual([`${DIR}/${KEY}.download`]);
});

test('并发首访共享同一次目录扫描，已落盘文件不重复下载', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const deps = makeDeps(stats, {
    readDir: async () => {
      await Promise.resolve();
      return [`${KEY}.png`, `${OTHER_KEY}.png`];
    },
  });
  const cache = new ImageCache(DIR, deps);
  const [first, second] = await Promise.all([
    cache.resolve(URL_WITH_H),
    cache.resolve(URL_OTHER),
  ]);
  expect(first).toBe(`${DIR}/${KEY}.png`);
  expect(second).toBe(`${DIR}/${OTHER_KEY}.png`);
  expect(stats.download.length).toBe(0);
});

test('落盘前清除同名旧文件，覆盖写幂等', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const files = new Set([`${DIR}/${KEY}.png`]);
  const cache = new ImageCache(
    DIR,
    makeDeps(stats, {
      readDir: async () => [],
      unlink: async (path) => {
        files.delete(path);
        stats.unlink.push(path);
      },
      moveFile: async (from, to) => {
        if (files.has(to)) {
          throw new Error('item with the same name already exists');
        }
        stats.moveFile.push([from, to]);
      },
    })
  );
  expect(await cache.resolve(URL_WITH_H)).toBe(`${DIR}/${KEY}.png`);
  expect(stats.unlink).toEqual([`${DIR}/${KEY}.png`]);
  expect(stats.moveFile).toEqual([
    [`${DIR}/${KEY}.download`, `${DIR}/${KEY}.png`],
  ]);
});

test('warmup 预热记忆映射，之后的 peek 同步命中不再下载', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const cache = new ImageCache(
    DIR,
    makeDeps(stats, {
      readDir: async () => [`${KEY}.png`],
    })
  );
  await cache.warmup();
  expect(cache.peek(URL_WITH_H)).toBe(`${DIR}/${KEY}.png`);
  expect(await cache.resolve(URL_WITH_H)).toBe(`${DIR}/${KEY}.png`);
  expect(stats.download.length).toBe(0);
});

test('目录扫描忽略 download 临时残留', async () => {
  const stats: CallStats = { download: [], moveFile: [], unlink: [] };
  const cache = new ImageCache(
    DIR,
    makeDeps(stats, {
      readDir: async () => [`${KEY}.download`],
    })
  );
  expect(await cache.resolve(URL_WITH_H)).toBe(`${DIR}/${KEY}.png`);
  expect(stats.download.length).toBe(1);
});
