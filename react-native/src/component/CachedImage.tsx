/**
 * @file component/CachedImage.tsx
 * @description 带内容哈希缓存的图片组件，五类图片的统一渲染入口。
 *   从地址的 h 查询参数提取缓存键，命中渲染本地 file 路径，
 *   未命中先渲染远端地址同时触发下载校验落盘，落定后切本地路径。
 *   地址无 h 参数时等价于普通 Image，由服务端 no-cache 防御兜底。
 */
import React, { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { parseHashKey } from '../storage/image-cache.ts';
import { imageCache } from '../storage/image-cache-rn.ts';

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
