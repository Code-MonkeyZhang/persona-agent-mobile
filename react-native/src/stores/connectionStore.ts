/**
 * @file stores/connectionStore.ts
 * @description 全局连接态管理。
 *   身份是唯一事实源，登记表的 currentHostId 推进后由 settleHost 派生落位，
 *   断旧链、切镜像库、复位旧主机的界面态、递增主机计数并驱动镜像重读，
 *   服务地址不独立存储，恒随登记表条目解析。
 *   已登记设备的切换先落位再核身，核身失败置红条不回滚视图，
 *   点当前设备则走核身重连的刷新链。connectByAddress 按握手、通报、落位、建链推进。
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
  /** 已落位主机，进程内跟踪，settle 据此跳过重复落位 */
  settledHostId: string;

  /** 把镜像与界面落位到目标主机，地址随条目解析，幂等且在途合并 */
  settleHost: (hostId: string) => Promise<void>;
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
  /** 连接失败落地址无效红条并留日志 */
  const fail = (message: string): void => {
    set({ status: 'address_invalid', error: message });
    logger.error(`[ConnectionStore] connect failed: ${message}`);
  };

  /** 在途落位任务，同目标的并发调用合并进同一条 Promise */
  let settleTask: { hostId: string; promise: Promise<void> } | null = null;

  /**
   * 落位的执行段，串行推进。
   * 身份持久化在前，断旧链清订阅后切镜像库，旧主机的界面态整体复位，
   * 主机计数与镜像版本最后递增，驱动界面重读目标主机的镜像。
   */
  const performSettle = async (hostId: string): Promise<void> => {
    logger.info(`[ConnectionStore] settling host ${hostId}`);
    useDeviceStore.getState().setCurrentHost(hostId);
    wsClient.disconnect();
    wsClient.clearSubscription();
    await cacheDb.switchHost(hostId);
    clearLastConversation();
    useSessionStore.getState().resetForHostSwitch();
    useChatStore.getState().resetForHostSwitch();
    set((state) => ({
      settledHostId: hostId,
      hostVersion: state.hostVersion + 1,
    }));
    useMirrorStore.getState().bump();
    logger.info(`[ConnectionStore] host ${hostId} settled`);
  };

  /**
   * 把镜像与界面落位到目标主机，身份唯一事实源的派生入口。
   * 服务地址恒随登记表条目解析，已落位主机不重放切库与复位，
   * 在途的同目标调用合并，异目标调用排在当前落位之后串行执行。
   */
  const settleHost = (hostId: string): Promise<void> => {
    const entry = useDeviceStore
      .getState()
      .devices.find((d) => d.hostId === hostId);
    if (!entry) {
      logger.warn(`[ConnectionStore] settle ${hostId} skipped, no entry`);
      return Promise.resolve();
    }
    saveServerAddress(entry.address);
    set({ serverAddress: entry.address });
    if (get().settledHostId === hostId) {
      return Promise.resolve();
    }
    const start = () => performSettle(hostId);
    const promise = settleTask
      ? settleTask.promise.then(start, start)
      : start();
    settleTask = { hostId, promise };
    return promise;
  };

  /**
   * 配对成功后的落位入口。条目元信息经 upsert 写进登记表并推进身份，
   * settle 随身份把镜像与界面切到新主机，调用方等它完成后才建链。
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
    await settleHost(info.hostId);
  };

  /**
   * 对已登记主机核身后建链，冷启动、刷新与切换链共用。
   * 核身失败或身份不符置地址无效红条，已落位的镜像与身份不受影响。
   */
  const connectToHost = async (entry: DeviceEntry): Promise<boolean> => {
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
      fail(`identity mismatch, expect ${entry.hostId} got ${info.hostId}`);
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
    settledHostId: '',

    settleHost: (hostId) => settleHost(hostId),

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
      // 点当前设备是刷新链走核身重连，其余目标先落位再核身，失败不回滚视图
      const refresh = hostId === currentHostId;
      logger.info(
        `[ConnectionStore] ${refresh ? 'refresh' : 'switch to'} ${hostId}`
      );
      set({ pendingHostId: hostId });
      try {
        if (refresh) {
          await connectToHost(entry);
          return;
        }
        await settleHost(hostId);
        const ok = await connectToHost(entry);
        // 切换失败后马上补查这一台，状态点红绿立见分晓
        if (!ok) {
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
        // 接替主机与手动切换同一条链，先落位再核身建链
        await settleHost(rest[0].hostId);
        await connectToHost(rest[0]);
      } else {
        wsClient.disconnect();
        // 清空落位标记，同台主机日后重新配对时走完整落位
        set({
          status: 'idle',
          serverAddress: '',
          error: '',
          settledHostId: '',
        });
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
