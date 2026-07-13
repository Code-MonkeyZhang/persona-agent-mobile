/**
 * @file stores/sessionStore.ts
 * @description 会话预览状态管理，在内存中维护每个会话最新一条消息的预览文本。
 *   不做持久化，app 重启后预览为空，随会话加载/收发消息逐步填充。
 */
import { create } from 'zustand';
import { logger } from '../lib/logger';

interface SessionStore {
  /** sessionId → 预览文本 */
  sessionPreviews: Record<string, string>;
  updateSessionPreview: (sessionId: string, preview: string) => void;
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
