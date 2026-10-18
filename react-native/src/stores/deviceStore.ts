/**
 * @file stores/deviceStore.ts
 * @description 手机端记住的主机清单。
 *   hostId 是身份，地址是属性，扫码与手动输入发现的身份经 connectionStore 落位到这里。
 *   连接、切换与删除的编排在 connectionStore，本仓库只管条目数据与当前指向，
 *   每次变更整体落 MMKV，镜像库文件的清理由调用方经 cacheDb 编排。
 */
import { create } from 'zustand';
import {
  type DeviceEntry,
  type DeviceRegistry,
  loadDeviceRegistry,
  saveDeviceRegistry,
} from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';

const TAG = '[DeviceStore]';

/** 连接成功时落位的已知事实，自称名只在新条目建档时作标签初始值 */
export interface ConnectedHost {
  hostId: string;
  hostName: string;
  version: string;
  address: string;
}

interface DeviceStore {
  devices: DeviceEntry[];
  /** 当前主机，空串表示一台都没有 */
  currentHostId: string;
  /** 启动引导时整体水化，存量迁移落盘后调用一次 */
  hydrate: (registry: DeviceRegistry) => void;
  /** 按身份落位，已知主机只更新地址与版本并给空名补初始值，未知建新条目并指向它 */
  upsertConnected: (host: ConnectedHost) => void;
  /** 改名只动显示名，空串表示回到未改名的兜底显示 */
  renameDevice: (hostId: string, name: string) => void;
  /** 删条目，删的是当前主机时清掉当前指向，镜像清理由调用方编排 */
  removeDevice: (hostId: string) => void;
  /** 指向某台主机，删除当前主机后的接替与冷启动兜底用 */
  setCurrentHost: (hostId: string) => void;
}

/** 变更后整体持久化 */
function persist(devices: DeviceEntry[], currentHostId: string): void {
  saveDeviceRegistry({ currentHostId, devices });
}

/** 建仓时读一次登记表，后续变更经动作整体写回 */
const initialRegistry = loadDeviceRegistry();

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: initialRegistry.devices,
  currentHostId: initialRegistry.currentHostId,

  hydrate: (registry) => {
    set({ devices: registry.devices, currentHostId: registry.currentHostId });
    logger.info(
      `${TAG} hydrated, ${registry.devices.length} devices, current=${
        registry.currentHostId || 'none'
      }`
    );
  },

  upsertConnected: (host) => {
    const { devices } = get();
    const existing = devices.find((d) => d.hostId === host.hostId);
    const next: DeviceEntry[] = existing
      ? devices.map((d) =>
          d.hostId === host.hostId
            ? {
                ...d,
                // 空名条目是建档时没拿到自称名的存量，首次握手补上初始值
                name: d.name || host.hostName,
                address: host.address,
                version: host.version,
                lastConnectedAt: Date.now(),
              }
            : d
        )
      : [
          ...devices,
          {
            hostId: host.hostId,
            name: host.hostName,
            address: host.address,
            version: host.version,
            lastConnectedAt: Date.now(),
          },
        ];
    set({ devices: next, currentHostId: host.hostId });
    persist(next, host.hostId);
    logger.info(
      `${TAG} ${existing ? 'address updated' : 'device added'}: ${host.hostId}`
    );
  },

  renameDevice: (hostId, name) => {
    const { devices, currentHostId } = get();
    const clean = name.trim();
    const next = devices.map((d) =>
      d.hostId === hostId ? { ...d, name: clean } : d
    );
    set({ devices: next });
    persist(next, currentHostId);
    logger.info(`${TAG} renamed ${hostId} -> "${clean}"`);
  },

  removeDevice: (hostId) => {
    const { devices, currentHostId } = get();
    const next = devices.filter((d) => d.hostId !== hostId);
    const current = currentHostId === hostId ? '' : currentHostId;
    set({ devices: next, currentHostId: current });
    persist(next, current);
    logger.info(`${TAG} removed ${hostId}`);
  },

  setCurrentHost: (hostId) => {
    const { devices } = get();
    if (!devices.some((d) => d.hostId === hostId)) {
      return;
    }
    set({ currentHostId: hostId });
    persist(devices, hostId);
    logger.info(`${TAG} current host -> ${hostId}`);
  },
}));
