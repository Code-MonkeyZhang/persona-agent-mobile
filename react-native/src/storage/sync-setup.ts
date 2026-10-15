/**
 * @file storage/sync-setup.ts
 * @description 镜像同步的装配模块，收拢全部接线。
 *   开库、组装引擎、注册 WS 同步监听、连接建立触发追平、
 *   追平进度按游标与结果写入 mirrorStore 的同步三态、
 *   写后通知经去抖递增镜像版本号驱动界面重读。
 *   agent 清单刷新器与图片排队下载器的单例也装配在此，
 *   失效事件经序号护栏触发清单重拉，清单落镜像后投喂图片队列。
 *   小手机偏好中枢单例同在此装配，快照与变更流写入走 LWW，
 *   连接恢复先追平镜像再照待重交标记补交本地编辑。
 *   追平前先认主机身份，镜像来源与当前主机不符或游标越过服务端头部时整库作废重镜像。
 *   App 启动时调用一次 setupSync，界面层只消费 mirrorStore 与镜像读接口。
 */
import { cacheDb } from './cache-db.ts';
import { SyncEngine } from './sync-engine.ts';
import {
  fetchHostId,
  fetchSyncChanges,
  fetchSyncSnapshot,
} from '../api/sync-api.ts';
import { AgentsSync } from './agents-sync.ts';
import { LauncherPrefs } from './launcher-prefs.ts';
import { ImagePrefetch } from './image-prefetch.ts';
import {
  fetchAgents,
  fetchPoses,
  getAgentAvatarUrl,
  getBackgroundImageUrl,
  getPoseImageUrl,
  noteAgentHashes,
  putLauncherOrder,
  putLauncherWallpaperCurrent,
} from '../api/server-api.ts';
import { imageCache } from './image-cache-rn.ts';
import * as wsClient from '../api/ws-client.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { useMirrorStore } from '../stores/mirrorStore.ts';
import { getServerAddress, storage } from './StorageUtils.ts';
import { logger } from '../lib/logger';

const TAG = '[SyncSetup]';

/** 写后通知驱动界面刷新的去抖间隔 */
const NOTIFY_DEBOUNCE_MS = 300;

let engine: SyncEngine | null = null;

/** 图片排队下载器单例，进度写进 mirrorStore 驱动横幅 */
const imagePrefetch = new ImagePrefetch({
  fetchPoses,
  avatarUrl: getAgentAvatarUrl,
  poseUrl: getPoseImageUrl,
  backgroundUrl: getBackgroundImageUrl,
  peek: (url) => imageCache.peek(url),
  resolve: (url) => imageCache.resolve(url),
  clearFailure: (url) => imageCache.clearFailure(url),
  onStateChange: (state) => useMirrorStore.getState().setImageSyncState(state),
  log: (message) => logger.info(`[ImagePrefetch] ${message}`),
});

/** agent 清单刷新器单例，装配层与界面层共用 */
export const agentsSync = new AgentsSync({
  fetchAgents,
  putAgents: (agents) => cacheDb.putAgents(agents),
  getServerAddress,
  onRefreshed: (agents) => imagePrefetch.feed(agents, getServerAddress()),
  log: (message) => logger.info(`[AgentsSync] ${message}`),
});

/** 小手机偏好中枢单例，快照与变更流写入、去抖提交与断网重交都在这里 */
export const launcherPrefs = new LauncherPrefs({
  kv: {
    get: (key) => storage.getString(key),
    set: (key, value) => storage.set(key, value),
    delete: (key) => storage.delete(key),
  },
  putOrder: putLauncherOrder,
  putWallpaper: putLauncherWallpaperCurrent,
  getServerAddress,
  log: (message) => logger.info(`[LauncherPrefs] ${message}`),
});

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
    getCursor: () => cacheDb.getCursor(),
    fetchHostId: () => fetchHostId(getServerAddress()),
    getSourceHostId: () => cacheDb.getSourceHostId(),
    setSourceHostId: (hostId) => cacheDb.setSourceHostId(hostId),
    // 作废镜像要把两处一起清，游标归零走快照重建，偏好镜像清掉免得时间戳挡住重放
    invalidateMirror: async () => {
      await cacheDb.resetCursor();
      launcherPrefs.invalidate();
    },
    applySnapshot: async (snapshot) => {
      await cacheDb.applySnapshot(snapshot);
      // 冷启动快照自带 agent 清单，先登记头像哈希再投喂图片队列
      if (snapshot.agents.length > 0) {
        noteAgentHashes(snapshot.agents);
        imagePrefetch.feed(snapshot.agents, getServerAddress());
      }
      launcherPrefs.applySnapshot(snapshot.launcher);
    },
    applyChanges: async (changes) => {
      await cacheDb.applyChanges(changes);
      // 回放完成后扫失效事件，通过序号护栏的触发整份重拉
      for (const change of changes) {
        if (
          change.kind === 'agents_invalidated' &&
          agentsSync.consumeInvalidation(change.seq)
        ) {
          logger.info(`${TAG} agents invalidated, seq=${change.seq}`);
          agentsSync.refresh();
        }
      }
      // 小手机偏好事件整份携带文档，LWW 落地后通知界面重读
      for (const change of changes) {
        launcherPrefs.applyChange(change);
      }
    },
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
      launcherPrefs.retryPending();
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
