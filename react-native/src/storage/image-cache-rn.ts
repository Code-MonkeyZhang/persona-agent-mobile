/**
 * @file storage/image-cache-rn.ts
 * @description 附件缓存的路由单例，按当前主机把调用派发给设备目录里的
 *   ImageCache 实例，设备目录为 Documents/cache/主机ID/attachments。
 *   渲染命中、排队下载与种入共用同一套实例表，忘掉设备即丢弃实例。
 */
import RNFS from 'react-native-fs';
import { ImageCache } from './image-cache.ts';
import { attachmentsDirFor } from './cache-layout.ts';
import { useDeviceStore } from '../stores/deviceStore.ts';
import { logger } from '../lib/logger';

/** 设备附件缓存实例表，键为 hostId */
const instances = new Map<string, ImageCache>();

/** 附件缓存能力的 RNFS 依赖，全部设备实例共用 */
const deps = {
  mkdir: (path: string) => RNFS.mkdir(path).catch(() => undefined),
  readDir: async (path: string) =>
    (await RNFS.readDir(path)).map((item) => item.name),
  unlink: (path: string) => RNFS.unlink(path),
  moveFile: (from: string, to: string) => RNFS.moveFile(from, to),
  copyFile: (from: string, to: string) => RNFS.copyFile(from, to),
  sha256: (path: string) => RNFS.hash(path, 'sha256'),
  download: (url: string, toFile: string) =>
    new Promise<{ statusCode: number; contentType?: string }>(
      (resolve, reject) => {
        let statusCode = 0;
        let contentType: string | undefined;
        const job = RNFS.downloadFile({
          fromUrl: url,
          toFile,
          background: false,
          connectionTimeout: 15_000,
          readTimeout: 30_000,
          begin: (res) => {
            statusCode = res.statusCode;
            const headers = res.headers as Record<string, string>;
            for (const name of Object.keys(headers)) {
              if (name.toLowerCase() === 'content-type') {
                contentType = headers[name];
              }
            }
          },
        });
        job.promise.then(() => resolve({ statusCode, contentType }), reject);
      }
    ),
  log: (message: string) => logger.info(`[ImageCache] ${message}`),
};

/** 取或建指定设备的附件缓存实例 */
function cacheFor(hostId: string): ImageCache {
  let cache = instances.get(hostId);
  if (!cache) {
    cache = new ImageCache(attachmentsDirFor(hostId), deps);
    instances.set(hostId, cache);
  }
  return cache;
}

/** 当前主机的附件缓存实例，主机未指派时返回 null */
function currentCache(): ImageCache | null {
  const hostId = useDeviceStore.getState().currentHostId;
  return hostId ? cacheFor(hostId) : null;
}

/** 路由单例，入口全部派发给当前主机的实例 */
export const imageCache = {
  /** 同步查本地路径，只看记忆映射，供组件首帧避免闪远端 */
  peek(source: string): string | null {
    return currentCache()?.peek(source) ?? null;
  },
  /** 解析地址到本地路径，未命中下载校验落盘，失败返回 null */
  resolve(source: string): Promise<string | null> {
    return currentCache()?.resolve(source) ?? Promise.resolve(null);
  },
  /** 按内容哈希解析任意附件到本地路径，键由调用方直接给出 */
  resolveByHash(hash: string, source: string): Promise<string | null> {
    return currentCache()?.resolveByHash(hash, source) ?? Promise.resolve(null);
  },
  /** 种入一张上传落定的图片，失败返回 null 不影响发送 */
  seed(
    hash: string,
    localUri: string,
    mimeType: string
  ): Promise<string | null> {
    return (
      currentCache()?.seed(hash, localUri, mimeType) ?? Promise.resolve(null)
    );
  },
  /** 清除失败哨兵，让下一次 resolve 重新尝试下载 */
  clearFailure(source: string): void {
    currentCache()?.clearFailure(source);
  },
  /** 预热当前主机实例的记忆映射，主机落位后调用 */
  warmup(): Promise<void> {
    return currentCache()?.warmup() ?? Promise.resolve();
  },
  /** 丢弃指定设备的实例，忘掉设备时与目录清理配套调用 */
  forget(hostId: string): void {
    instances.delete(hostId);
  },
};
