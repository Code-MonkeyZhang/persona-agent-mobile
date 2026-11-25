/**
 * @file hooks/useActiveModel.ts
 * @description 当前生效模型的解析，聊天页的模型入口、弹层选中态与看图提示共用同一套判断。
 *   会话已存在时读镜像库里的会话模型，另一端换了模型经镜像版本号驱动重读。
 *   会话尚未建立时读 chatStore 的草稿暂存，再回落 Agent 默认模型。
 */
import { useEffect, useState } from 'react';
import type { ModelConfig } from '../../api/server-api.ts';
import { cacheDb } from '../../storage/cache-db.ts';
import { getServerAgentId } from '../../storage/StorageUtils.ts';
import { useChatStore } from '../../stores/chatStore.ts';
import { useMirrorStore } from '../../stores/mirrorStore.ts';
import { NEW_CHAT_SESSION } from '../../stores/sessionStore.ts';
import { logger } from '../../lib/logger';

/**
 * 当前生效模型。
 * 读到的会话模型连同会话 id 一起存，切会话后旧值不冒充新会话的模型。
 * 读到的值没变时保留旧引用，镜像版本频繁变化触发的重读不会让订阅方重渲染。
 * @param agentDefault Agent 默认模型，进页拉取完成前为 null
 * @returns 当前生效模型，会话模型与草稿都没有且 Agent 默认模型未到手时为 null
 */
export function useActiveModel(
  agentDefault: ModelConfig | null
): ModelConfig | null {
  const sessionId = useChatStore((s) => s.displayedSessionId);
  const draftModel = useChatStore((s) => s.draftModel);
  const mirrorVersion = useMirrorStore((s) => s.version);
  const agentId = getServerAgentId();
  const [sessionModel, setSessionModel] = useState<{
    sessionId: string;
    model: ModelConfig;
  } | null>(null);

  useEffect(() => {
    if (sessionId === NEW_CHAT_SESSION) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // 服务端在首条消息发出前可能还没给会话落模型，缺字段时维持回落
        const model = (await cacheDb.getSessionMeta(sessionId))?.model;
        if (cancelled || !model?.provider || !model.model) {
          return;
        }
        setSessionModel((prev) =>
          prev?.sessionId === sessionId &&
          prev.model.provider === model.provider &&
          prev.model.model === model.model
            ? prev
            : { sessionId, model }
        );
      } catch (e) {
        logger.warn(
          `[useActiveModel] read session model failed, session=${sessionId}: ${
            e instanceof Error ? e.message : e
          }`
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, mirrorVersion]);

  if (sessionId === NEW_CHAT_SESSION) {
    return draftModel?.agentId === agentId ? draftModel.model : agentDefault;
  }
  return sessionModel?.sessionId === sessionId
    ? sessionModel.model
    : agentDefault;
}
