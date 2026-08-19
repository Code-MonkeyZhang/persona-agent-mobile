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
  apps: AppInfo[];
  currentAppId: string | null;

  loadApps: (serverAddress: string) => Promise<void>;
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
