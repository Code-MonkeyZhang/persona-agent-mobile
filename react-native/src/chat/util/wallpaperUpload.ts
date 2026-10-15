/**
 * @file chat/util/wallpaperUpload.ts
 * @description 壁纸上传前的选图与压缩管线。
 *   选图响应自带宽高，短边不足 720 直接拒绝；
 *   compressor 压两遍，主图 maxWidth 1080 质量 0.85，缩略图 maxWidth 240，
 *   输出 jpeg，规范与服务端校验对齐。
 */
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as CompressorImage } from 'react-native-compressor';
import { logger } from '../../lib/logger';
import type { WallpaperUploadPair } from '../../api/server-api';

const TAG = '[WallpaperUpload]';

/** 服务端校验的主图短边下限 */
const MIN_SHORT_SIDE = 720;
const MAIN_MAX_SIDE = 1080;
const THUMB_MAX_SIDE = 240;
const MAIN_QUALITY = 0.85;

/** 选图结果，取消与过小分流，屏幕层据此给出不同提示 */
export type PrepareResult =
  | { status: 'ok'; pair: WallpaperUploadPair }
  | { status: 'cancelled' }
  | { status: 'tooSmall' };

/**
 * 压一遍出图。
 * 手动模式按横竖图把短边压进上限，横图限高竖图限宽，
 * 保证压缩后短边不跌破服务端的下限。
 */
async function compressToPart(
  uri: string,
  width: number,
  height: number,
  maxSide: number,
  quality: number,
  name: string
): Promise<WallpaperUploadPair['image']> {
  const landscape = width > height;
  const output = await CompressorImage.compress(uri, {
    compressionMethod: 'manual',
    maxWidth: landscape ? undefined : maxSide,
    maxHeight: landscape ? maxSide : undefined,
    quality,
    output: 'jpg',
  });
  return { uri: output, name, type: 'image/jpeg' };
}

/** 选图、验短边、压主图与缩略图，压缩失败抛错由调用方兜提示 */
export async function prepareWallpaperUpload(): Promise<PrepareResult> {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
  });
  const asset = result.assets?.[0];
  if (!asset?.uri) {
    return { status: 'cancelled' };
  }
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const shortSide = Math.min(width, height);
  if (shortSide < MIN_SHORT_SIDE) {
    logger.info(`${TAG} rejected, short side ${shortSide}`);
    return { status: 'tooSmall' };
  }
  try {
    const [image, thumb] = await Promise.all([
      compressToPart(
        asset.uri,
        width,
        height,
        MAIN_MAX_SIDE,
        MAIN_QUALITY,
        'wallpaper.jpg'
      ),
      compressToPart(
        asset.uri,
        width,
        height,
        THUMB_MAX_SIDE,
        MAIN_QUALITY,
        'thumb.jpg'
      ),
    ]);
    return { status: 'ok', pair: { image, thumb } };
  } catch (e) {
    logger.error(`${TAG} compress failed: ${e}`);
    throw e;
  }
}
