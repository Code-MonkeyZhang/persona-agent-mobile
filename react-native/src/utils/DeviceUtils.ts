/**
 * @file DeviceUtils.ts
 * @description 设备身份工具：deviceId 持久化、设备名获取与缓存。
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import {
  getDeviceId,
  saveDeviceName,
  getSavedDeviceName,
} from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';

export { getDeviceId };

/**
 * 异步获取真实设备名并缓存到 MMKV。
 * App 冷启动时调一次，后续 getCachedDeviceName 同步读取。
 */
export async function refreshDeviceName(): Promise<void> {
  try {
    const name = await DeviceInfo.getDeviceName();
    saveDeviceName(name);
    logger.info(`[DeviceUtils] deviceName cached="${name}"`);
  } catch (e) {
    logger.warn(`[DeviceUtils] getDeviceName failed: ${e}`);
  }
}

/**
 * 同步读取缓存的设备名。
 * 首次调用（缓存未初始化）返回 Platform 兜底值。
 */
export function getCachedDeviceName(): string {
  const cached = getSavedDeviceName();
  if (cached) {
    return cached;
  }
  return Platform.OS === 'ios' ? 'iPhone' : 'Android';
}
