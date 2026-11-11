/**
 * @fileoverview 设备缓存目录布局与旧布局的一次性迁移。
 *   全部客户端缓存收在 Documents/cache 下按设备分目录，设备目录内是
 *   mirror.db 镜像库与 attachments 附件分区，忘掉设备即删整个设备目录。
 *   旧布局是默认目录平铺的 persona-cache-主机ID 库文件与 Documents/image-cache，
 *   迁移按登记表驱动，幂等可重跑。
 */
import { open } from '@op-engineering/op-sqlite';
import RNFS from 'react-native-fs';

/** 缓存根目录，全部客户端缓存的唯一入口 */
const CACHE_ROOT = `${RNFS.DocumentDirectoryPath}/cache`;

/** 设备目录内镜像库文件名 */
const MIRROR_FILE_NAME = 'mirror.db';

/** 设备目录内附件分区目录名 */
const ATTACHMENTS_DIR_NAME = 'attachments';

/** 旧布局镜像库文件名前缀，后接主机号，躺在 op-sqlite 默认目录 */
const LEGACY_MIRROR_PREFIX = 'persona-cache-';

/** 旧布局图片缓存目录，内容无法归属设备，整体废弃 */
const LEGACY_IMAGE_CACHE_DIR = `${RNFS.DocumentDirectoryPath}/image-cache`;

/** 镜像库主文件的伴生后缀，wal 与 shm */
export const MIRROR_SIDECARS = ['', '-wal', '-shm'];

/** 设备缓存目录路径 */
export function deviceDirFor(hostId: string): string {
  return `${CACHE_ROOT}/${hostId}`;
}

/**
 * 镜像库开库参数。
 * op-sqlite 的 location 收绝对目录路径，原生层负责逐级创建。
 */
export function mirrorOpenParams(hostId: string): {
  name: string;
  location: string;
} {
  return { name: MIRROR_FILE_NAME, location: deviceDirFor(hostId) };
}

/** 设备目录内镜像库文件的完整路径 */
export function mirrorPathFor(hostId: string): string {
  return `${deviceDirFor(hostId)}/${MIRROR_FILE_NAME}`;
}

/** 设备附件分区目录路径 */
export function attachmentsDirFor(hostId: string): string {
  return `${deviceDirFor(hostId)}/${ATTACHMENTS_DIR_NAME}`;
}

/** 删除设备的整个缓存目录，镜像库文件与附件分区一并消失 */
export async function removeDeviceDir(hostId: string): Promise<void> {
  await RNFS.unlink(deviceDirFor(hostId)).catch(() => undefined);
}

/**
 * 把单台主机的旧镜像库文件族迁进设备目录。
 * 以旧名开一次库借原生层拿到真实路径，探测会顺带建出零字节空文件，
 * 主文件按字节数判定真身，零字节或目标已在都按残留清理。
 * 伴生先迁主文件后迁，主文件落位即完成标记，中断后重跑幂等。
 * @param hostId - 目标主机号
 * @param log - 迁移动作日志
 */
export async function migrateLegacyMirror(
  hostId: string,
  log: (message: string) => void
): Promise<void> {
  const legacyName = `${LEGACY_MIRROR_PREFIX}${hostId}`;
  const probe = open({ name: legacyName });
  const legacyBase = probe.getDbPath();
  probe.close();
  const target = mirrorPathFor(hostId);
  const stat = await RNFS.stat(legacyBase).catch(() => null);
  const hasRealLegacy = stat !== null && stat.size > 0;
  const targetExists = await RNFS.exists(target).catch(() => false);
  if (hasRealLegacy && !targetExists) {
    await RNFS.mkdir(deviceDirFor(hostId)).catch(() => undefined);
    for (const suffix of ['-wal', '-shm', '']) {
      const from = `${legacyBase}${suffix}`;
      if (await RNFS.exists(from).catch(() => false)) {
        await RNFS.moveFile(from, `${target}${suffix}`);
      }
    }
    log(`migrated legacy mirror of ${hostId} into device directory`);
    return;
  }
  for (const suffix of ['', '-wal', '-shm']) {
    await RNFS.unlink(`${legacyBase}${suffix}`).catch(() => undefined);
  }
  if (hasRealLegacy) {
    log(`removed orphan legacy mirror of ${hostId}, target already in place`);
  }
}

/** 删除旧布局的图片缓存目录，内容无法归属设备，看时按新布局重新下载 */
export async function removeLegacyImageCacheDir(): Promise<void> {
  if (await RNFS.exists(LEGACY_IMAGE_CACHE_DIR).catch(() => false)) {
    await RNFS.unlink(LEGACY_IMAGE_CACHE_DIR).catch(() => undefined);
  }
}
