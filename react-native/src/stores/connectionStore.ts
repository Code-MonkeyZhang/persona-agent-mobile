/**
 * @file stores/connectionStore.ts
 * @description 全局连接态管理。
 *   统一服务器地址（凭证）和连接状态（运行时），所有组件通过此 store 响应式读取连接态。
 *   WebSocket 生命周期由 ws-client 单例管理，store 负责编排握手核身、条目落位、
 *   镜像库切换与 WS 建链。connectByAddress 按握手、通报、落位切库、建链四阶段推进，
 *   任一阶段失败保留旧主机现场。已登记主机的切换与冷启动共用 connectToHost 核身链。
 *   状态点只反映当前设备的连接事实，非当前设备一律灰，不做后台探测。
 */
import { create } from 'zustand';
import {
  clearLastConversation,
  getServerAddress,
  saveServerAddress,
  type DeviceEntry,
} from '../storage/StorageUtils.ts';
import { connectToServer } from '../api/connection-service.ts';
import { fetchHandshakeInfo, type HandshakeInfo } from '../api/sync-api.ts';
import * as wsClient from '../api/ws-client.ts';
import { cacheDb } from '../storage/cache-db.ts';
import { useDeviceStore } from './deviceStore.ts';
import { useSessionStore } from './sessionStore.ts';
import { useChatStore } from './chatStore.ts';
import { useMirrorStore } from './mirrorStore.ts';
import { logger } from '../lib/logger';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'address_invalid';

interface ConnectionStore {
  status: ConnectionStatus;
  /** 进入 connected 时递增，供上层监听做消息自愈 */
  reconnectVersion: number;
  serverAddress: string;
  error: string;
  /** 主机接管计数，界面层据此复位启动恢复守卫 */
  hostVersion: number;

  connectByAddress: (url: string) => Promise<boolean>;
  switchDevice: (hostId: string) => Promise<void>;
  forgetDevice: (hostId: string) => Promise<void>;
  disconnect: () => void;
  coldStart: () => Promise<void>;
  setStatus: (status: ConnectionStatus) => void;
  setAddress: (address: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => {
  /** 连接失败落地址无效态并留日志 */
  const fail = (message: string): void => {
    set({ status: 'address_invalid', error: message });
    logger.error(`[ConnectionStore] connect failed: ${message}`);
  };

  /**
   * 落位并接管连接。
   * 条目按身份落进登记表，镜像库切到该主机，旧主机的界面态整体复位，
   * 主机计数递增驱动界面重走启动恢复。
   */
  const activateHost = async (
    info: HandshakeInfo,
    address: string
  ): Promise<void> => {
    useDeviceStore.getState().upsertConnected({
      hostId: info.hostId,
      hostName: info.hostName,
      version: info.version,
      address,
    });
    saveServerAddress(address);
    set((state) => ({
      serverAddress: address,
      hostVersion: state.hostVersion + 1,
    }));
    await cacheDb.switchHost(info.hostId);
    clearLastConversation();
    wsClient.clearSubscription();
    useSessionStore.getState().resetForHostSwitch();
    useChatStore.getState().resetForHostSwitch();
    useMirrorStore.getState().bump();
  };

  /**
   * 对已登记主机握手核身后接管连接。
   * 地址失效或身份不符都保留旧主机现场，身份不符不落任何写。
   */
  const connectToHost = async (entry: DeviceEntry): Promise<boolean> => {
    const prev = get().status;
    set({ status: 'connecting', error: '' });
    logger.info(
      `[ConnectionStore] connecting host ${entry.hostId} at ${entry.address}`
    );
    let info;
    try {
      info = await fetchHandshakeInfo(entry.address);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
      return false;
    }
    if (info.hostId !== entry.hostId) {
      set({ status: prev, error: 'identity mismatch' });
      logger.error(
        `[ConnectionStore] identity mismatch, expect ${entry.hostId} got ${info.hostId}`
      );
      return false;
    }
    await activateHost(info, entry.address);
    wsClient.connect(entry.address);
    return true;
  };

  return {
    status: 'idle',
    reconnectVersion: 0,
    serverAddress: getServerAddress(),
    error: '',
    hostVersion: 0,

    connectByAddress: async (url) => {
      const address = url.trim().replace(/\/+$/, '');
      if (!address) {
        set({ status: 'idle', error: 'Empty URL' });
        return false;
      }
      set({ status: 'connecting', error: '' });
      logger.info(`[ConnectionStore] connecting to ${address}`);

      let info;
      try {
        info = await fetchHandshakeInfo(address);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return false;
      }
      const paired = await connectToServer(address);
      if (!paired.success) {
        fail(paired.error ?? 'Connection failed');
        return false;
      }
      await activateHost(info, address);
      wsClient.connect(address);
      logger.info(
        `[ConnectionStore] host ${info.hostId} activated, WS connecting`
      );
      return true;
    },

    switchDevice: async (hostId) => {
      const { devices, currentHostId } = useDeviceStore.getState();
      if (hostId === currentHostId) {
        return;
      }
      const entry = devices.find((d) => d.hostId === hostId);
      if (!entry) {
        return;
      }
      await connectToHost(entry);
    },

    forgetDevice: async (hostId) => {
      const wasCurrent = hostId === useDeviceStore.getState().currentHostId;
      useDeviceStore.getState().removeDevice(hostId);
      await cacheDb.deleteHostDb(hostId);
      logger.info(`[ConnectionStore] device forgotten: ${hostId}`);
      if (!wasCurrent) {
        return;
      }
      const rest = useDeviceStore.getState().devices;
      if (rest.length > 0) {
        useDeviceStore.getState().setCurrentHost(rest[0].hostId);
        await connectToHost(rest[0]);
      } else {
        wsClient.disconnect();
        set({ status: 'idle', serverAddress: '', error: '' });
      }
    },

    disconnect: () => {
      logger.info('[ConnectionStore] disconnect');
      wsClient.disconnect();
      set({ status: 'idle' });
    },

    coldStart: async () => {
      const { currentHostId, devices } = useDeviceStore.getState();
      if (!currentHostId) {
        logger.info(
          '[ConnectionStore] coldStart: no device registered, staying idle'
        );
        return;
      }
      const entry = devices.find((d) => d.hostId === currentHostId);
      if (entry) {
        await connectToHost(entry);
      }
    },

    setStatus: (status) => {
      logger.info(`[ConnectionStore] status → ${status}`);
      set((state) => {
        const justConnected =
          status === 'connected' && state.status !== 'connected';
        return justConnected
          ? { status, reconnectVersion: state.reconnectVersion + 1 }
          : { status };
      });
    },

    setAddress: (address) => set({ serverAddress: address }),
  };
});
