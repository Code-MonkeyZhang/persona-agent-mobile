/**
 * @file stores/compressionConfigStore.ts
 * @description 全局压缩配置的唯一客户端缓存。
 *   压缩开关与阈值是两端共享的服务端全局配置，不走 settingsStore 的本地 MMKV，
 *   设置页偏好节读写都走这里的缓存。写路径读旧值合并 compression 节回写，
 *   不覆盖服务端其他配置字段。
 */
import { create } from 'zustand';
import {
  fetchAppConfig,
  updateCompressionConfig,
  type AppConfig,
  type CompressionConfig,
} from '../api/server-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';

const TAG = '[CompressionConfig]';

interface CompressionConfigStore {
  /** 最近一次拉到的全量配置，null 表示尚未拉过 */
  appConfig: AppConfig | null;
  /**
   * 拉取全局配置，已持有且不强制时跳过。
   * 无主机地址时静默返回，偏好节不渲染。
   */
  load: (force?: boolean) => Promise<void>;
  /**
   * 乐观写压缩节进本地缓存，界面立即跟随，写回失败时调用方用旧值再调一次回滚。
   */
  applyLocal: (compression: CompressionConfig) => void;
  /**
   * 写回压缩节，成功后同步本地缓存，失败抛错由调用方回滚界面。
   * 未拉过全量配置时没有合并基准，直接拒绝。
   */
  save: (compression: CompressionConfig) => Promise<void>;
}

export const useCompressionConfigStore = create<CompressionConfigStore>(
  (set, get) => ({
    appConfig: null,
    load: async (force = false) => {
      if (!force && get().appConfig) return;
      const address = getServerAddress();
      if (!address) {
        logger.warn(`${TAG} load skipped, no server address`);
        return;
      }
      const appConfig = await fetchAppConfig(address);
      set({ appConfig });
    },
    applyLocal: (compression) => {
      const current = get().appConfig;
      if (!current) return;
      set({ appConfig: { ...current, compression } });
    },
    save: async (compression) => {
      const address = getServerAddress();
      const current = get().appConfig;
      if (!address || !current) {
        throw new Error('config not loaded');
      }
      await updateCompressionConfig(address, current, compression);
      set({ appConfig: { ...current, compression } });
    },
  })
);
