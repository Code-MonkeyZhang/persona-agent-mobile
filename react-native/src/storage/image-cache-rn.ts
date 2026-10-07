/**
 * @file storage/image-cache-rn.ts
 * @description ImageCache 的 RNFS 实现单例。
 *   缓存目录在 Documents 下且只增不清，CachedImage 的渲染命中
 *   与图片排队下载共用同一实例，共享记忆映射与去重表。
 */
import RNFS from 'react-native-fs';
import { ImageCache } from './image-cache.ts';
import { logger } from '../lib/logger';

/** RNFS 实现的图片缓存单例 */
export const imageCache = new ImageCache(
  `${RNFS.DocumentDirectoryPath}/image-cache`,
  {
    mkdir: (path) => RNFS.mkdir(path).catch(() => undefined),
    readDir: async (path) =>
      (await RNFS.readDir(path)).map((item) => item.name),
    unlink: (path) => RNFS.unlink(path),
    moveFile: (from, to) => RNFS.moveFile(from, to),
    sha256: (path) => RNFS.hash(path, 'sha256'),
    download: (url, toFile) =>
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
    log: (message) => logger.info(`[ImageCache] ${message}`),
  }
);
