/**
 * @file component/CachedImage.tsx
 * @description 带内容哈希缓存的图片组件，五类图片的统一渲染入口。
 *   从地址的 h 查询参数提取缓存键，命中渲染本地 file 路径，
 *   未命中先渲染远端地址同时触发下载校验落盘，落定后切本地路径。
 *   地址无 h 参数时等价于普通 Image，由服务端 no-cache 防御兜底。
 */
import React, { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import RNFS from 'react-native-fs';
import { ImageCache, parseHashKey } from '../storage/image-cache.ts';
import { logger } from '../lib/logger';

/** RNFS 实现的图片缓存单例，目录在 Documents 下且只增不清 */
const imageCache = new ImageCache(`${RNFS.DocumentDirectoryPath}/image-cache`, {
  mkdir: (path) => RNFS.mkdir(path).catch(() => undefined),
  readDir: async (path) => (await RNFS.readDir(path)).map((item) => item.name),
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
});

/** CachedImage 的 Props，与 Image 的常用子集对齐，source 换成字符串地址 */
export interface CachedImageProps {
  /** 可能带 h 查询参数的完整图片地址 */
  source: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
  onLoad?: () => void;
  onError?: () => void;
}

const CachedImage: React.FC<CachedImageProps> = ({
  source,
  style,
  resizeMode = 'cover',
  onLoad,
  onError,
}) => {
  /** 本地命中路径，null 表示渲染远端地址 */
  const [localPath, setLocalPath] = useState<string | null>(() =>
    imageCache.peek(source)
  );

  /** 地址变化时重置为记忆映射的同步结果，再异步补一次完整解析 */
  useEffect(() => {
    let cancelled = false;
    setLocalPath(imageCache.peek(source));
    if (parseHashKey(source)) {
      imageCache.resolve(source).then((path) => {
        if (!cancelled && path) {
          setLocalPath(path);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <Image
      source={{ uri: localPath ?? source }}
      style={style}
      resizeMode={resizeMode}
      onLoad={onLoad}
      onError={onError}
    />
  );
};

export default CachedImage;
