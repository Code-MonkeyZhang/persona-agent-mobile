/**
 * @file stores/sessionStore.ts
 * @description 会话状态管理。
 *   - sessionPreviews/sessionTitles：内存态的预览文本与标题，不持久化，随会话加载/收发消息/标题更新逐步填充
 *   - activeSessionId：当前会话身份与列表高亮依据，侧边栏与会话页共同读写的唯一协作来源
 *   - drawerRefreshVersion：侧边栏重新拉取列表与 Agent 卡片的触发器
 *   activeSessionId 初始值取上一次会话，使冷启动能恢复上次会话。
 */
import { create } from 'zustand';
import { logger } from '../lib/logger';
import { getLastSessionId } from '../storage/StorageUtils';

interface SessionStore {
  /** sessionId → 预览文本 */
  sessionPreviews: Record<string, string>;
  updateSessionPreview: (sessionId: string, preview: string) => void;

  /** sessionId → 标题，由 WS title_updated 事件实时更新 */
  sessionTitles: Record<string, string>;
  updateSessionTitle: (sessionId: string, title: string) => void;

  /** 当前会话身份与高亮依据，空串表示新建聊天/无会话 */
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;

  /** 侧边栏刷新触发器，加一即触发一次列表与 Agent 卡片重拉 */
  drawerRefreshVersion: number;
  requestDrawerRefresh: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionPreviews: {},

  updateSessionPreview: (sessionId, preview) => {
    logger.debug(
      `[SessionStore] preview updated: sessionId=${sessionId} preview="${preview.substring(
        0,
        40
      )}"`
    );
    set((state) => ({
      sessionPreviews: {
        ...state.sessionPreviews,
        [sessionId]: preview,
      },
    }));
  },

  sessionTitles: {},

  updateSessionTitle: (sessionId, title) => {
    logger.debug(
      `[SessionStore] title updated: sessionId=${sessionId} title="${title}"`
    );
    set((state) => ({
      sessionTitles: {
        ...state.sessionTitles,
        [sessionId]: title,
      },
    }));
  },

  activeSessionId: getLastSessionId(),

  setActiveSessionId: (id) => {
    logger.info(`[SessionStore] activeSessionId → ${id}`);
    set({ activeSessionId: id });
  },

  drawerRefreshVersion: 0,

  requestDrawerRefresh: () =>
    set((state) => ({
      drawerRefreshVersion: state.drawerRefreshVersion + 1,
    })),
}));

/**
 * 从消息内容中提取预览文本：去除 HTML 标签后截取前 50 个字符。
 */
export function extractPreview(content: string): string {
  return content
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, 50);
}
