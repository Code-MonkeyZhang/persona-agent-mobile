/**
 * @file hooks/useCompanionMode.ts
 * @description 陪伴面板状态管理：面板开关、pose 资源加载、背景错误标记。
 *   当前姿态与立绘加载错误保存在 chatStore 会话分片中，随会话切换恢复。
 */
import { useState, useEffect, useCallback } from 'react';
import { Keyboard } from 'react-native';
import {
  fetchPoses,
  notePoseAssets,
  type PoseAssets,
} from '../../api/server-api';
import {
  saveCompanionOpen,
  getCompanionOpen,
  savePosesAssets,
  getPosesAssets,
} from '../../storage/StorageUtils';
import { logger } from '../../lib/logger';

export function useCompanionMode(
  agentId: string,
  serverAddressRef: React.MutableRefObject<string>
) {
  /** 陪伴面板是否展开（滑动容器右侧 pane），从 MMKV 恢复上次状态 */
  const [companionOpen, setCompanionOpen] = useState(getCompanionOpen);
  /** Agent 是否拥有陪伴资源：null=加载中, true=有, false=无 */
  const [hasAssets, setHasAssets] = useState<boolean | null>(null);
  /** 背景图加载失败标记 */
  const [bgError, setBgError] = useState(false);

  /** Agent 切换时请求 pose 清单，成功落 MMKV，失败回退本地清单保证断网可用 */
  useEffect(() => {
    if (!agentId || !serverAddressRef.current) {
      return;
    }
    let cancelled = false;
    setHasAssets(null);
    setBgError(false);
    logger.info(`[Companion] fetchPoses agentId=${agentId}`);
    fetchPoses(agentId, serverAddressRef.current)
      .then((assets: PoseAssets) => {
        savePosesAssets(agentId, assets);
        if (!cancelled) {
          setHasAssets(assets.poses.length > 0);
        }
      })
      .catch(() => {
        const cached = getPosesAssets(agentId);
        if (cached) {
          notePoseAssets(agentId, cached);
          if (!cancelled) {
            setHasAssets(cached.poses.length > 0);
          }
          logger.info('[Companion] poses loaded from local cache');
          return;
        }
        logger.error('[Companion] fetchPoses failed');
        if (!cancelled) {
          setHasAssets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, serverAddressRef]);

  /** 切换陪伴面板：先收键盘再 toggle，持久化到 MMKV */
  const handleToggleCompanion = useCallback(() => {
    Keyboard.dismiss();
    setCompanionOpen((prev) => {
      const next = !prev;
      saveCompanionOpen(next);
      logger.info(`[Companion] ${next ? 'open' : 'close'}`);
      return next;
    });
  }, []);

  return {
    companionOpen,
    hasAssets,
    bgError,
    setBgError,
    handleToggleCompanion,
  };
}
