/**
 * @file storage/sync-setup.ts
 * @description 镜像同步的装配模块，收拢全部接线。
 *   开库、组装引擎、注册 WS 同步监听、连接建立触发追平、
 *   追平进度按游标与结果写入 mirrorStore 的同步三态、
 *   写后通知经去抖递增镜像版本号驱动界面重读。
 *   App 启动时调用一次 setupSync，界面层只消费 mirrorStore 与镜像读接口。
 */
import { cacheDb } from './cache-db.ts';
import { SyncEngine } from './sync-engine.ts';
import { fetchSyncChanges, fetchSyncSnapshot } from '../api/sync-api.ts';
import * as wsClient from '../api/ws-client.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { useMirrorStore } from '../stores/mirrorStore.ts';
import { getServerAddress } from './StorageUtils.ts';
import { logger } from '../lib/logger';

const TAG = '[SyncSetup]';

/** 写后通知驱动界面刷新的去抖间隔 */
const NOTIFY_DEBOUNCE_MS = 300;

let engine: SyncEngine | null = null;

/**
 * 装配镜像同步链路，幂等，App 启动时调用一次。
 * 追平在连接进入 connected 时触发，快照拉取用调用时点的服务器地址。
 */
export function setupSync(): void {
  if (engine) {
    return;
  }
  engine = new SyncEngine({
    fetchSnapshot: () => fetchSyncSnapshot(getServerAddress()),
    fetchChanges: (since, limit) =>
      fetchSyncChanges(getServerAddress(), since, limit),
    getCursor: async () => cacheDb.getCursor(),
    applySnapshot: (snapshot) => cacheDb.applySnapshot(snapshot),
    applyChanges: (changes) => cacheDb.applyChanges(changes),
    log: (message) => logger.info(`${TAG} ${message}`),
    onCatchUpStart: (cursor) => {
      if (cursor === 0) {
        useMirrorStore.getState().setSyncState('syncing');
      }
    },
    onCatchUpSuccess: () => {
      const { syncState, setSyncState, bumpCatchUp } =
        useMirrorStore.getState();
      if (syncState !== 'ready') {
        logger.info(`${TAG} first catch-up done`);
        setSyncState('ready');
      }
      bumpCatchUp();
    },
  });
  wsClient.registerSyncHandler((change) => engine?.onChange(change));

  let lastStatus = useConnectionStore.getState().status;
  useConnectionStore.subscribe((state) => {
    if (state.status === 'connected' && lastStatus !== 'connected') {
      logger.info(`${TAG} connected, catching up mirror`);
      engine?.sync();
    }
    lastStatus = state.status;
  });

  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  cacheDb.onChanged(() => {
    if (notifyTimer) {
      clearTimeout(notifyTimer);
    }
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      useMirrorStore.getState().bump();
    }, NOTIFY_DEBOUNCE_MS);
  });
  logger.info(`${TAG} mirror sync wired`);
}
