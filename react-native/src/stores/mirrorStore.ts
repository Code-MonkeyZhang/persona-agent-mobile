/**
 * @file stores/mirrorStore.ts
 * @description 镜像版本号仓库。
 *   镜像库写后通知经去抖递增 version，界面层订阅 version 重读镜像，
 *   替代桌面端经 IPC 推送的刷新链路。
 *   syncState 是首次全量同步的进度，游标为零的追平在途为 syncing，
 *   完成后闩锁在 ready，连接横幅据此展示同步态。
 *   catchUpVersion 是追平完成计数，每次引擎追平成功后递增，
 *   聊天页订阅它在重连或冷启动追平后补拉一次离线期间的消息。
 */
import { create } from 'zustand';

/** 首次全量同步的进度，syncing 只在游标为零的追平期间出现 */
export type MirrorSyncState = 'idle' | 'syncing' | 'ready';

interface MirrorStore {
  /** 镜像数据版本号，每次写后通知递增 */
  version: number;
  /** 追平完成计数，每次引擎追平成功后递增 */
  catchUpVersion: number;
  /** 首次全量同步进度，完成后停在 ready */
  syncState: MirrorSyncState;
  /** 递增版本号，驱动订阅方重读镜像 */
  bump: () => void;
  /** 递增追平完成计数，驱动订阅方补拉离线期间的变化 */
  bumpCatchUp: () => void;
  /** 写同步进度，装配层按游标与追平结果驱动 */
  setSyncState: (state: MirrorSyncState) => void;
}

export const useMirrorStore = create<MirrorStore>((set) => ({
  version: 0,
  catchUpVersion: 0,
  syncState: 'idle',
  bump: () => set((state) => ({ version: state.version + 1 })),
  bumpCatchUp: () =>
    set((state) => ({ catchUpVersion: state.catchUpVersion + 1 })),
  setSyncState: (state) => set({ syncState: state }),
}));
