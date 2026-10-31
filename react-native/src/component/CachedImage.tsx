/**
 * @file component/CachedImage.tsx
 * @description 带内容哈希缓存的图片组件，五类图片的统一渲染入口。
 *   渲染走三态，判定中渲染占位不碰网络，本地命中渲染 file 路径，
 *   解析确认未命中才渲染远端地址，下载校验落盘后切回本地路径。
 *   地址无 h 参数时直接远端，由服务端 no-cache 防御兜底。
 */
import React, { useEffect, useState } from 'react';
import { Image, View, type ImageStyle, type StyleProp } from 'react-native';
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

/** 图片地址的三态解析，判定中不碰网络，确认未命中才放行远端 */
type Resolution =
  | { kind: 'pending' }
  | { kind: 'local'; path: string }
  | { kind: 'remote' };

/** 占位灰底，判定中的图片区域用中性色占住布局 */
const PLACEHOLDER_BG = '#E8E8ED';

const CachedImage: React.FC<CachedImageProps> = ({
  source,
  style,
  resizeMode = 'cover',
  onLoad,
  onError,
}) => {
  /** 首帧同步取三态，记忆映射热时直接本地，冷时先占位等解析 */
  const [resolution, setResolution] = useState<Resolution>(() => {
    if (!parseHashKey(source)) {
      return { kind: 'remote' };
    }
    const hit = imageCache.peek(source);
    return hit ? { kind: 'local', path: hit } : { kind: 'pending' };
  });

  /** 地址变化时重走三态，异步解析确认未命中才放行远端 */
  useEffect(() => {
    let cancelled = false;
    if (!parseHashKey(source)) {
      setResolution({ kind: 'remote' });
      return;
    }
    const hit = imageCache.peek(source);
    if (hit) {
      setResolution({ kind: 'local', path: hit });
      return;
    }
    setResolution({ kind: 'pending' });
    imageCache.resolve(source).then((path) => {
      if (!cancelled) {
        setResolution(path ? { kind: 'local', path } : { kind: 'remote' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (resolution.kind === 'pending') {
    return <View style={[style, { backgroundColor: PLACEHOLDER_BG }]} />;
  }

  return (
    <Image
      /** 安卓的 Image 静默拒绝绘制不带 file scheme 的本地路径，iOS 对两种写法都接受，本地命中统一补前缀。 */
      source={{
        uri:
          resolution.kind === 'local' ? `file://${resolution.path}` : source,
      }}
      style={style}
      resizeMode={resizeMode}
      onLoad={onLoad}
      onError={onError}
    />
  );
};

export default CachedImage;
