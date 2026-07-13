/**
 * @file AgentAvatar.tsx
 * @description 共享的 Agent 头像组件，带 onError 回退和 React.memo 优化。
 * 所有需要展示 Agent 头像的地方都应使用此组件，避免重复加载和逻辑分散。
 */
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { User } from 'lucide-react-native';
import { getAgentAvatarUrl } from '../../api/server-api';
import { logger } from '../../lib/logger';

/** Agent 头像组件 Props */
export interface AgentAvatarProps {
  /** Agent ID，用于拼接头像 URL */
  agentId: string;
  /** 服务器地址，用于拼接头像 URL */
  serverAddress: string;
  /** 头像直径，width = height = size，borderRadius = size / 2 */
  size: number;
  /** 回退状态下 User 图标的尺寸，默认为 size * 0.55 */
  fallbackIconSize?: number;
  /** 回退背景色，默认 '#E5E7EB' */
  fallbackBackgroundColor?: string;
  /** 右侧间距，用于行布局中头像与文字之间的分隔 */
  marginRight?: number;
}

/**
 * 共享 Agent 头像组件。
 *
 * 内部封装了 URL 构建、加载失败回退、agentId 切换时重置错误状态等逻辑，
 * 并通过 React.memo 确保相同 agentId + serverAddress 时不重复渲染，
 * 配合 ChatScreen 中的 Image.prefetch 预加载可避免逐条消息重复请求头像。
 */
const AgentAvatar: React.FC<AgentAvatarProps> = ({
  agentId,
  serverAddress,
  size,
  fallbackIconSize,
  fallbackBackgroundColor = '#E5E7EB',
  marginRight = 0,
}) => {
  const [avatarError, setAvatarError] = useState(false);

  /** agentId 或 serverAddress 变化时重置错误状态 */
  useEffect(() => {
    setAvatarError(false);
  }, [agentId, serverAddress]);

  const canLoad = serverAddress.length > 0 && agentId.length > 0;
  const borderRadius = size / 2;
  const baseStyle = {
    width: size,
    height: size,
    borderRadius,
    marginRight,
  };

  if (canLoad && !avatarError) {
    return (
      <Image
        source={{ uri: getAgentAvatarUrl(agentId, serverAddress) }}
        style={baseStyle}
        onError={() => {
          logger.warn(`[AgentAvatar] load failed, agentId=${agentId}`);
          setAvatarError(true);
        }}
      />
    );
  }

  return (
    <View style={[baseStyle, styles.fallback, { backgroundColor: fallbackBackgroundColor }]}>
      <User size={fallbackIconSize ?? Math.round(size * 0.55)} color="#9CA3AF" />
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

export default React.memo(AgentAvatar);
