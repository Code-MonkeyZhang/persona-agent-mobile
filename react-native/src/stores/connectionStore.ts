/**
 * @file stores/connectionStore.ts
 * @description 全局连接态管理。
 *   统一服务器地址（凭证）和连接状态（运行时），所有组件通过此 store 响应式读取连接态。
 *   WebSocket 生命周期由 ws-client 单例管理，store 负责编排握手核身、条目落位、
 *   镜像库切换与 WS 建链。connectByAddress 按握手、通报、落位切库、建链四阶段推进，
 *   任一阶段失败保留旧主机现场。已登记设备的切换与刷新共用 switchDevice 入口，
 *   切换链对全局状态全程静默，点当前设备则走冷启动链刷新重建。
 *   设备探测只在清单可见期间运行，探测结论与连接事实共同决定状态点颜色。
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
  | 'offline'
  | 'address_invalid';

/** 单台设备的探测超时，几秒内无回应即判连不上 */
const PROBE_TIMEOUT_MS = 5000;

/** 清单可见期间的探测轮询间隔 */
const PROBE_INTERVAL_MS = 30_000;

interface ConnectionStore {
  status: ConnectionStatus;
  /** 进入 connected 时递增，供上层监听做消息自愈 */
  reconnectVersion: number;
  serverAddress: string;
  error: string;
  /** 主机接管计数，界面层据此复位启动恢复守卫 */
  hostVersion: number;
  /** 探测结论，hostId 到能否连上的映射，缺项表示还没查过 */
  probes: Record<string, boolean>;
  /** 切换进行中的目标主机，空串表示没有切换在途 */
  pendingHostId: string;

  connectByAddress: (url: string) => Promise<boolean>;
  /** 点其他设备切换连接，点当前设备刷新重建链路，在途时静默忽略 */
  switchDevice: (hostId: string) => Promise<void>;
  forgetDevice: (hostId: string) => Promise<void>;
  disconnect: () => void;
  coldStart: () => Promise<void>;
  setStatus: (status: ConnectionStatus) => void;
  setAddress: (address: string) => void;
  /** 探测单台设备，握手即探测，身份不符也算连不上 */
  probeDevice: (hostId: string) => Promise<void>;
  /** 探测全部设备并按间隔轮询，返回停止函数，清单关闭时调用 */
  startProbing: () => () => void;
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
   * preservePrevOnFailure 供切换链使用，进入与失败全程不碰全局状态，失败只记日志。
   */
  const connectToHost = async (
    entry: DeviceEntry,
    preservePrevOnFailure = false
  ): Promise<boolean> => {
    const prev = get().status;
    // preserve 模式下旧链路还在跑，进入时不惊动全局状态
    if (!preservePrevOnFailure) {
      set({ status: 'connecting', error: '' });
    }
    logger.info(
      `[ConnectionStore] connecting host ${entry.hostId} at ${entry.address}`
    );
    let info;
    try {
      info = await fetchHandshakeInfo(entry.address);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (preservePrevOnFailure) {
        // 切换失败旧链路未动，全局状态从未变化，只记日志不打扰横幅
        logger.warn(
          `[ConnectionStore] switch to ${entry.hostId} failed: ${message}`
        );
      } else {
        fail(message);
      }
      return false;
    }
    if (info.hostId !== entry.hostId) {
      if (!preservePrevOnFailure) {
        set({ status: prev, error: 'identity mismatch' });
      }
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
    probes: {},
    pendingHostId: '',

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
      // 同一时刻只允许一条切换或刷新链，在途时忽略新目标
      if (get().pendingHostId) {
        return;
      }
      const { devices, currentHostId } = useDeviceStore.getState();
      const entry = devices.find((d) => d.hostId === hostId);
      if (!entry) {
        return;
      }
      // 点当前设备是刷新链路走冷启动链重建，其余目标是切换链不碰全局
      const refresh = hostId === currentHostId;
      logger.info(
        `[ConnectionStore] ${refresh ? 'refresh' : 'switch to'} ${hostId}`
      );
      set({ pendingHostId: hostId });
      try {
        const ok = await connectToHost(entry, !refresh);
        // 切换失败后马上补查这一台，状态点红绿立见分晓
        if (!ok && !refresh) {
          get()
            .probeDevice(hostId)
            .catch(() => undefined);
        }
      } finally {
        set({ pendingHostId: '' });
      }
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

    probeDevice: async (hostId) => {
      const entry = useDeviceStore
        .getState()
        .devices.find((d) => d.hostId === hostId);
      if (!entry) {
        return;
      }
      let reachable = false;
      try {
        const info = await fetchHandshakeInfo(entry.address, PROBE_TIMEOUT_MS);
        reachable = info.hostId === hostId;
      } catch {
        reachable = false;
      }
      // 结论没变时不写状态不打日志，轮询期间保持安静
      const { probes } = get();
      if (probes[hostId] === reachable) {
        return;
      }
      set({ probes: { ...probes, [hostId]: reachable } });
      if (reachable) {
        logger.info(
          `[ConnectionStore] probe ${hostId} reachable at ${entry.address}`
        );
      } else {
        logger.warn(
          `[ConnectionStore] probe ${hostId} unreachable at ${entry.address}`
        );
      }
    },

    startProbing: () => {
      const probeAll = () => {
        for (const device of useDeviceStore.getState().devices) {
          get()
            .probeDevice(device.hostId)
            .catch(() => undefined);
        }
      };
      probeAll();
      const timer = setInterval(probeAll, PROBE_INTERVAL_MS);
      logger.info('[ConnectionStore] round probing started');
      return () => {
        clearInterval(timer);
        logger.info('[ConnectionStore] round probing stopped');
      };
    },
  };
});
