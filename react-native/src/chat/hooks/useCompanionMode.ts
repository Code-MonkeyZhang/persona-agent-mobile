/**
 * @file hooks/useCompanionMode.ts
 * @description 陪伴面板状态管理：面板开关、pose 资源加载、姿态切换、错误标记。
 */
import { useState, useEffect, useCallback } from 'react';
import { Keyboard } from 'react-native';
import { fetchPoses } from '../../api/server-api';
import {
  saveCompanionOpen,
  getCompanionOpen,
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
  /** 当前展示的姿态名称，由 show_pose 指令切换 */
  const [currentPose, setCurrentPose] = useState('default');
  /** 背景图加载失败标记 */
  const [bgError, setBgError] = useState(false);
  /** 立绘图加载失败标记 */
  const [poseError, setPoseError] = useState(false);

  /** Agent 切换时请求 pose 列表，判断是否有陪伴资源 */
  useEffect(() => {
    if (!agentId || !serverAddressRef.current) {
      return;
    }
    let cancelled = false;
    setHasAssets(null);
    setBgError(false);
    setPoseError(false);
    logger.info(`[Companion] fetchPoses agentId=${agentId}`);
    fetchPoses(agentId, serverAddressRef.current)
      .then((poses) => {
        logger.info(`[Companion] poses loaded: ${poses.length}`);
        if (!cancelled) {
          setHasAssets(poses.length > 0);
        }
      })
      .catch(() => {
        logger.error('[Companion] fetchPoses failed');
        if (!cancelled) {
          setHasAssets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, serverAddressRef]);

  /** currentPose 变化时清除立绘加载错误 */
  useEffect(() => {
    setPoseError(false);
  }, [currentPose]);

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
    setCompanionOpen,
    hasAssets,
    currentPose,
    setCurrentPose,
    bgError,
    setBgError,
    poseError,
    setPoseError,
    handleToggleCompanion,
  };
}
