/**
 * @file stores/connectionStore.ts
 * @description 全局连接态管理。
 *   统一服务器地址（凭证）和连接状态（运行时），所有组件通过此 store 响应式读取连接态。
 *   WebSocket 生命周期由 ws-client 单例管理，store 负责编排 pair → WS connect 流程。
 */
import { create } from 'zustand';
import { getServerAddress } from '../storage/StorageUtils.ts';
import { connectToServer } from '../api/connection-service.ts';
import * as wsClient from '../api/ws-client.ts';
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
  /** 扫码页写入、连接页消费的一次性中转地址；goBack 无法携带参数，故用此字段回传 */
  pendingScannedUrl: string;

  /** pair + WS connect，ServerScreen 和 coldStart 调用 */
  connect: (url: string) => Promise<void>;
  /** 主动断开 */
  disconnect: () => void;
  /** 读 MMKV 地址，有则 connect */
  coldStart: () => Promise<void>;
  /**
   * ws-client 内部回调用，更新连接状态。
   * 进入 connected 时递增 reconnectVersion，供上层监听做消息自愈。
   */
  setStatus: (status: ConnectionStatus) => void;
  /** 更新服务器地址 */
  setAddress: (address: string) => void;
  /** 扫码页写入扫到的地址，供连接页聚焦时消费 */
  setPendingScannedUrl: (url: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  status: 'idle',
  reconnectVersion: 0,
  serverAddress: getServerAddress(),
  error: '',
  pendingScannedUrl: '',

  connect: async (url) => {
    const address = url.trim().replace(/\/+$/, '');
    if (!address) {
      set({ status: 'idle', error: 'Empty URL' });
      return;
    }

    set({ status: 'connecting', error: '' });
    logger.info(`[ConnectionStore] connecting to ${address}`);

    const result = await connectToServer(address);
    if (result.success) {
      set({ serverAddress: address });
      wsClient.connect(address);
      logger.info('[ConnectionStore] pair ok, WS connecting');
    } else {
      set({
        status: 'address_invalid',
        error: result.error ?? 'Connection failed',
      });
      logger.error(`[ConnectionStore] pair failed: ${result.error}`);
    }
  },

  disconnect: () => {
    logger.info('[ConnectionStore] disconnect');
    wsClient.disconnect();
    set({ status: 'idle' });
  },

  coldStart: async () => {
    const address = getServerAddress();
    if (!address) {
      logger.info(
        '[ConnectionStore] coldStart: no saved address, staying idle'
      );
      return;
    }
    logger.info(`[ConnectionStore] coldStart: address=${address}`);
    await get().connect(address);
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

  setPendingScannedUrl: (url) => set({ pendingScannedUrl: url }),
}));
