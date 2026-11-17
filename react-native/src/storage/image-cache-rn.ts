/**
 * @file storage/image-cache-rn.ts
 * @description 附件缓存的路由单例，按当前主机把调用派发给设备目录里的
 *   ImageCache 实例，设备目录为 Documents/cache/主机ID/attachments。
 *   渲染命中、排队下载与种入共用同一套实例表，忘掉设备即丢弃实例。
 */
import RNFS from 'react-native-fs';
import { downloadAsync } from 'expo-file-system/legacy';
import { ImageCache } from './image-cache.ts';
import { attachmentsDirFor } from './cache-layout.ts';
import { useDeviceStore } from '../stores/deviceStore.ts';
import { logger } from '../lib/logger';

/** 设备附件缓存实例表，键为 hostId */
const instances = new Map<string, ImageCache>();

/** 附件缓存能力依赖，全部设备实例共用，文件操作走 RNFS，下载走 expo-file-system */
const deps = {
  mkdir: (path: string) => RNFS.mkdir(path).catch(() => undefined),
  readDir: async (path: string) =>
    (await RNFS.readDir(path)).map((item) => item.name),
  unlink: (path: string) => RNFS.unlink(path),
  moveFile: (from: string, to: string) => RNFS.moveFile(from, to),
  copyFile: (from: string, to: string) => RNFS.copyFile(from, to),
  sha256: (path: string) => RNFS.hash(path, 'sha256'),
  /**
   * 下载走 expo-file-system 的 legacy downloadAsync，返回状态与响应头，
   * 失败以携带非空 code 的错误 reject 给 JS 层兜底。
   * RNFS 的 downloadFile 失败回调里以 null code 调 reject，新 bridge 的
   * PromiseImpl 非空断言直接 NPE 崩进程，2026-11-16 真机复现后弃用该通道。
   * 目标 URI 必须是 file:/// 开头，Android 权限校验对无 scheme 的纯路径
   * 只授读权限会拒写，RNFS 风格的纯路径在这里统一补前缀。
   */
  download: async (url: string, toFile: string) => {
    const fileUri = toFile.startsWith('file://') ? toFile : `file://${toFile}`;
    const result = await downloadAsync(url, fileUri);
    const headers = result.headers;
    let contentType: string | undefined;
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'content-type') {
        contentType = headers[name];
      }
    }
    return { statusCode: result.status, contentType };
  },
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
