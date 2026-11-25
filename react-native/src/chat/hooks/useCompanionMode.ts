/**
 * @file hooks/useCompanionMode.ts
 * @description 陪伴面板状态管理：面板开关、资源就绪态、背景错误标记。
 *   立绘清单的加载收敛在 performanceStore 的 loadCatalog，这里只消费它的结果。
 *   演出状态在 performanceStore，会话元数据记录的立绘名在 chatStore 会话分片。
 */
import { useState, useEffect, useCallback } from 'react';
import { Keyboard } from 'react-native';
import {
  saveCompanionOpen,
  getCompanionOpen,
} from '../../storage/StorageUtils';
import { loadCatalog } from '../../stores/performanceStore.ts';
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

  /** Agent 切换时重拉立绘清单，网络失败由加载器回退本地缓存，两条路径都无才算没有资源 */
  useEffect(() => {
    if (!agentId || !serverAddressRef.current) {
      return;
    }
    let cancelled = false;
    setHasAssets(null);
    setBgError(false);
    logger.info(`[Companion] load catalog agentId=${agentId}`);
    loadCatalog(agentId, true)
      .then((assets) => {
        if (!cancelled) {
          setHasAssets(assets.poses.length > 0);
        }
      })
      .catch(() => {
        logger.error('[Companion] pose catalog unavailable');
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
