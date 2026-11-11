/**
 * @file component/CachedImage.tsx
 * @description 带内容哈希缓存的图片组件，五类图片的统一渲染入口。
 *   渲染走三态，判定中渲染占位不碰网络，本地命中位图渲染 file 路径，
 *   矢量图读出文本交 react-native-svg 渲染，解析确认未命中才渲染远端地址，
 *   下载校验落盘后切回本地路径。地址无 h 参数时直接远端，由服务端 no-cache 防御兜底。
 */
import React, { useEffect, useState } from 'react';
import {
  Image,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import RNFS from 'react-native-fs';
import { SvgXml } from 'react-native-svg';
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

/** 本地矢量文件的后缀，原生 Image 画不了这类落盘图 */
const SVG_EXTENSION = '.svg';

/** 矢量外层的裁剪样式，收住图标盒的圆角 */
const SVG_CLIP: ViewStyle = { overflow: 'hidden' };

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

  /** 本地矢量的文本内容，读到才建渲染树 */
  const [svgXml, setSvgXml] = useState<string | null>(null);

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

  /** 本地命中的当前路径，矢量判定与读取的依据 */
  const localPath = resolution.kind === 'local' ? resolution.path : null;

  /** 本地矢量读出文本交渲染，读失败回落远端地址走位图失败链上报 */
  useEffect(() => {
    setSvgXml(null);
    if (!localPath?.endsWith(SVG_EXTENSION)) {
      return;
    }
    let cancelled = false;
    RNFS.readFile(localPath, 'utf8')
      .then((xml) => {
        if (!cancelled) {
          setSvgXml(xml);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolution({ kind: 'remote' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [localPath]);

  const isLocalSvg = localPath?.endsWith(SVG_EXTENSION) ?? false;

  if (resolution.kind === 'pending' || (isLocalSvg && svgXml === null)) {
    return <View style={[style, { backgroundColor: PLACEHOLDER_BG }]} />;
  }

  /** 矢量走 react-native-svg 按容器填满裁剪，缩放语义与位图的 resizeMode 对齐 */
  if (isLocalSvg && svgXml !== null) {
    return (
      <View style={[style, SVG_CLIP]}>
        <SvgXml
          xml={svgXml}
          width="100%"
          height="100%"
          preserveAspectRatio={
            resizeMode === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'
          }
          onLoad={onLoad}
          onError={onError}
        />
      </View>
    );
  }

  return (
    <Image
      /** 安卓的 Image 静默拒绝绘制不带 file scheme 的本地路径，iOS 对两种写法都接受，本地命中统一补前缀。 */
      source={{
        uri: resolution.kind === 'local' ? `file://${resolution.path}` : source,
      }}
      style={style}
      resizeMode={resizeMode}
      onLoad={onLoad}
      onError={onError}
    />
  );
};

export default CachedImage;
