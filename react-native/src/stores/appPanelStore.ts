/**
 * @file stores/appPanelStore.ts
 * @description Agent App 工作区数据。导航由 Stack Navigator 管理，本 store 只管：
 *   - apps：服务器上支持手机端的 Agent App 列表
 *   - currentAppId：当前选中的 App（null = 未选），驱动"恢复上次 App"逻辑
 *   不持久化——关即卸载 WebView，重开重载（与桌面 MVP 一致）。
 */
import { create } from 'zustand';
import { logger } from '../lib/logger';
import { fetchAgentApps, type AppInfo } from '../api/server-api';

interface AppPanelStore {
  /** 支持手机端的 Agent App 列表 */
  apps: AppInfo[];
  /** 当前指向的 App，null 表示未选（下次进工作区开网格） */
  currentAppId: string | null;

  /** 从服务器拉取 App 列表并写入 store */
  loadApps: (serverAddress: string) => Promise<void>;
  /** 设置当前 App（null = 清空，用于从网格退出时重置恢复态） */
  setCurrentAppId: (id: string | null) => void;
}

const TAG = '[AppPanelStore]';

export const useAppPanelStore = create<AppPanelStore>((set) => ({
  apps: [],
  currentAppId: null,

  loadApps: async (serverAddress) => {
    logger.info(`${TAG} loadApps start`);
    try {
      const apps = await fetchAgentApps(serverAddress);
      set({ apps });
    } catch (e) {
      logger.error(`${TAG} loadApps failed: ${e}`);
    }
  },

  setCurrentAppId: (id) => {
    logger.info(`${TAG} setCurrentAppId: ${id}`);
    set({ currentAppId: id });
  },
}));
