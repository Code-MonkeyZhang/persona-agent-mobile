/**
 * @file AgentSelector.tsx
 * @description Agent 选择触发按钮，渲染在聊天页面导航栏中央。
 * 点击后测量按钮位置，弹出 AgentSelectionModal 下拉菜单供用户切换 Agent。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { User } from 'lucide-react-native';
import { useTheme, ColorScheme } from '../../theme';
import type { AgentInfo } from '../../api/server-api';
import { getAgentAvatarUrl } from '../../api/server-api';
import { getServerAddress } from '../../storage/StorageUtils';
import AgentSelectionModal from './AgentSelectionModal';
import { logger } from '../../lib/logger';

/** Agent 选择器 Props */
interface AgentSelectorProps {
  /** 从服务器获取的可用 Agent 列表 */
  agents: AgentInfo[];
  /** 当前选中的 Agent ID */
  currentAgentId: string;
  /** 切换 Agent 时的回调，参数为新选中的 Agent ID */
  onSelectAgent: (agentId: string) => void;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
/** 下拉菜单宽度，用于定位计算 */
const MODAL_WIDTH = 220;

/**
 * Agent 选择触发按钮。
 *
 * 渲染为导航栏中央的「头像 + 名称 + 下拉箭头」组合，
 * 点击后通过 measure() 获取按钮的屏幕坐标，计算下拉菜单的定位，
 * 然后打开 AgentSelectionModal 让用户切换当前 Agent。
 */
const AgentSelector: React.FC<AgentSelectorProps> = ({
  agents,
  currentAgentId,
  onSelectAgent,
}) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  /** 触发按钮的 ref，用于 measure() 获取屏幕坐标 */
  const triggerRef = useRef<View>(null);
  const [visible, setVisible] = useState(false);
  /** 下拉菜单的左上角屏幕坐标 */
  const [iconPosition, setIconPosition] = useState({ x: 0, y: 70 });

  const currentAgent = agents.find((a) => a.id === currentAgentId);
  const displayName = currentAgent?.name ?? 'Agent';
  const [avatarError, setAvatarError] = useState(false);

  /**
   * 是否具备加载头像的条件：服务器地址和 Agent ID 都不为空。
   * Android 端对无效 URL（如 /api/agents//avatar）不会触发 onError，
   * 因此需要在渲染前拦截，避免 warning 且不显示占位符。
   */
  const serverAddr = getServerAddress();
  const canLoadAvatar = serverAddr.length > 0 && currentAgentId.length > 0;

  /** 切换 Agent 时重置头像加载失败状态 */
  useEffect(() => {
    setAvatarError(false);
  }, [currentAgentId]);

  /**
   * 点击触发按钮时，测量按钮在屏幕上的位置，
   * 然后计算出下拉菜单应该出现的 (x, y) 坐标：
   * - x: 按钮中心对齐菜单中心，并 clamp 到屏幕边界内
   * - y: 按钮底部偏移 4px
   */
  const handleOpen = () => {
    logger.debug('[AgentSelector] open menu');
    triggerRef.current?.measure((_x, _y, _width, _height, pageX, pageY) => {
      const centerX = pageX + _width / 2;
      const clampedX = Math.max(
        10,
        Math.min(centerX - MODAL_WIDTH / 2, SCREEN_WIDTH - MODAL_WIDTH - 10)
      );
      // Android measure() 的 pageY 包含 status bar 高度，需要补偿
      const adjustedY =
        Platform.OS === 'android'
          ? pageY + (StatusBar.currentHeight ?? 0)
          : pageY;
      setIconPosition({ x: clampedX, y: adjustedY + _height + 4 });
      setVisible(true);
    });
  };

  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <>
      {/* 触发按钮：显示当前 Agent 头像 + 名称 + 下拉箭头 */}
      <TouchableOpacity
        style={styles.trigger}
        onPress={handleOpen}
        activeOpacity={0.7}
      >
        {/* collapsable=false 确保 Android 上 ref.measure() 能正确获取坐标 */}
        <View ref={triggerRef} collapsable={false} style={styles.triggerInner}>
          {/* Agent 头像：具备加载条件时请求服务器 URL，否则显示灰色占位符 */}
          {canLoadAvatar && !avatarError ? (
            <Image
              source={{ uri: getAgentAvatarUrl(currentAgentId, serverAddr) }}
              style={styles.triggerAvatar}
              onError={() => {
                logger.warn(
                  `[AgentSelector] avatar load failed, agentId=${currentAgentId}`
                );
                setAvatarError(true);
              }}
            />
          ) : (
            <View
              style={[styles.triggerAvatar, { backgroundColor: '#E5E7EB' }]}
            >
              <User size={12} color="#9CA3AF" />
            </View>
          )}
          <Text style={styles.triggerName} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.triggerArrow}>▼</Text>
        </View>
      </TouchableOpacity>
      {/* Agent 下拉选择菜单 */}
      <AgentSelectionModal
        visible={visible}
        onClose={handleClose}
        iconPosition={iconPosition}
        agents={agents}
        currentAgentId={currentAgentId}
        onSelectAgent={onSelectAgent}
      />
    </>
  );
};

/** 触发按钮样式工厂 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    trigger: {
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    triggerInner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    triggerAvatar: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    triggerName: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      marginLeft: 8,
      maxWidth: 160,
    },
    triggerArrow: {
      fontSize: 10,
      color: colors.textSecondary,
      marginLeft: 4,
    },
  });

export default AgentSelector;
