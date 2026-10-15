/**
 * @file stores/appPanelStore.ts
 * @description Agent App 工作区数据。导航由 Stack Navigator 管理，本 store 只管：
 *   - apps：服务器上支持手机端的 Agent App 列表
 *   - status：清单加载态，驱动桌面屏骨架与状态条，apps 非空时静默刷新
 *   - currentAppId：当前选中的 App（null = 未选），AppSurface 渲染哪个 App 的数据源
 *   - wallpaperDoc：壁纸文档的镜像，权威副本在 launcher-prefs，随监听刷新
 *   - appOrder：桌面网格的展示序，偏好文档与清单对账后的视图
 *   排列与壁纸的落盘与提交都在 launcher-prefs，本 store 只做响应式投影。
 *   不持久化 WebView 状态——关即卸载，重开重载（与桌面 MVP 一致）。
 */
import { create } from 'zustand';
import { logger } from '../lib/logger';
import { fetchAgentApps, type AppInfo } from '../api/server-api';
import { launcherPrefs } from '../storage/sync-setup.ts';
import type { WallpaperDoc } from '../storage/sync-shapes.ts';
import {
  reconcileOrder,
  SETTINGS_SLOT_ID,
} from '../chat/util/launcherOrder.ts';

/** 清单加载态，loading 首拉或重试在途、ready 成功、error 请求失败 */
export type AppLoadStatus = 'loading' | 'ready' | 'error';

interface AppPanelStore {
  apps: AppInfo[];
  status: AppLoadStatus;
  currentAppId: string | null;
  wallpaperDoc: WallpaperDoc | null;
  appOrder: (string | null)[];

  loadApps: (serverAddress: string) => Promise<void>;
  setCurrentAppId: (id: string | null) => void;
  setWallpaper: (id: string | null) => void;
  /** 提交拖拽落位后的完整排列，已是收尾空位的槽位数组 */
  applyOrder: (order: (string | null)[]) => void;
}

const TAG = '[AppPanelStore]';

export const useAppPanelStore = create<AppPanelStore>((set, get) => {
  /**
   * 偏好文档到展示序的投影。
   * 排列文档与当前清单对账，壁纸文档整体镜像，
   * 内容没变时沿用旧引用，避免监听风暴触发重渲染。
   * 排列视图变化时落一行日志，排查两端排列对齐用。
   */
  const refresh = () => {
    const orderDoc = launcherPrefs.getOrderDoc();
    const wallpaperDoc = launcherPrefs.getWallpaperDoc();
    const view = reconcileOrder(
      orderDoc?.appOrder ?? null,
      get().apps.map((a) => a.name),
      [SETTINGS_SLOT_ID]
    );
    const prev = get();
    const nextOrder =
      JSON.stringify(view) === JSON.stringify(prev.appOrder)
        ? prev.appOrder
        : view;
    if (nextOrder !== prev.appOrder || wallpaperDoc !== prev.wallpaperDoc) {
      if (nextOrder !== prev.appOrder) {
        logger.info(`${TAG} order view ${JSON.stringify(nextOrder)}`);
      }
      set({ appOrder: nextOrder, wallpaperDoc });
    }
  };
  launcherPrefs.addListener(refresh);

  return {
    apps: [],
    status: 'loading',
    currentAppId: null,
    wallpaperDoc: null,
    appOrder: [],

    loadApps: async (serverAddress) => {
      logger.info(`${TAG} loadApps start`);
      set({ status: 'loading' });
      try {
        const apps = await fetchAgentApps(serverAddress);
        logger.info(`${TAG} loadApps ready, ${apps.length} apps`);
        set({ apps, status: 'ready' });
        refresh();
      } catch (e) {
        logger.error(`${TAG} loadApps failed: ${e}`);
        set({ status: 'error' });
      }
    },

    setCurrentAppId: (id) => {
      logger.info(`${TAG} setCurrentAppId: ${id}`);
      set({ currentAppId: id });
    },

    setWallpaper: (id) => {
      logger.info(`${TAG} setWallpaper: ${id}`);
      const customs = launcherPrefs.getWallpaperDoc()?.customs ?? [];
      launcherPrefs.saveLocalWallpaper({ currentId: id, customs });
    },

    applyOrder: (order) => {
      if (JSON.stringify(order) === JSON.stringify(get().appOrder)) return;
      logger.info(`${TAG} order applied ${JSON.stringify(order)}`);
      launcherPrefs.saveLocalOrder(order);
    },
  };
});
