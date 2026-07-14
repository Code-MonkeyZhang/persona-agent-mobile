/**
 * @file CompanionContent.tsx
 * @description 陪伴模式纯展示组件：背景图 + 角色立绘。
 * 所有数据通过 props 传入，内部不做任何 WebSocket 或 API 调用。
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  getBackgroundImageUrl,
  getPoseImageUrl,
} from '../../api/server-api.ts';
import { logger } from '../../lib/logger';
import { useTheme, type ColorScheme } from '../../theme';

interface CompanionContentProps {
  agentId: string;
  serverAddr: string;
  /** Agent 是否拥有陪伴资源（null=加载中, true=有, false=无） */
  hasAssets: boolean | null;
  /** 当前姿态名称 */
  currentPose: string;
  /** 背景图加载失败标记 */
  bgError: boolean;
  /** 立绘图加载失败标记 */
  poseError: boolean;
  onBgError: () => void;
  onPoseError: () => void;
}

/**
 * 陪伴内容展示层：背景图、角色立绘。
 * 作为滑动容器的右侧 pane 渲染，所有状态由 ChatScreen 通过 props 驱动。
 */
const CompanionContent = React.memo(function CompanionContent({
  agentId,
  serverAddr,
  hasAssets,
  currentPose,
  bgError,
  poseError,
  onBgError,
  onPoseError,
}: CompanionContentProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCompanionStyles(colors);

  const showBackground = hasAssets === true && !bgError;
  const showPose = hasAssets === true && !poseError;

  return (
    <View style={styles.container}>
      {showBackground && (
        <Image
          source={{ uri: getBackgroundImageUrl(agentId, serverAddr) }}
          style={StyleSheet.absoluteFillObject}
          onLoad={() => logger.info('[Companion] background loaded')}
          onError={() => {
            logger.warn('[Companion] background load failed');
            onBgError();
          }}
          resizeMode="cover"
        />
      )}

      {showPose && (
        <View style={styles.poseLayer} pointerEvents="none">
          <Image
            source={{ uri: getPoseImageUrl(agentId, currentPose, serverAddr) }}
            style={StyleSheet.absoluteFillObject}
            onLoad={() => logger.info(`[Companion] pose ${currentPose} loaded`)}
            onError={() => {
              logger.warn(`[Companion] pose ${currentPose} load failed`);
              onPoseError();
            }}
            resizeMode="contain"
          />
        </View>
      )}

      {hasAssets === false && (
        <View style={styles.centerContent}>
          <Text style={styles.noAssetTitle}>{t('companion.noAssetTitle')}</Text>
          <Text style={styles.noAssetHint}>{t('companion.noAssetHint')}</Text>
        </View>
      )}
    </View>
  );
});

const useCompanionStyles = (colors: ColorScheme) =>
  React.useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.surface,
        },
        poseLayer: {
          position: 'absolute',
          bottom: 40,
          left: 0,
          right: 0,
          height: '85%',
        },
        centerContent: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        },
        noAssetTitle: {
          fontSize: 22,
          fontWeight: '600',
          color: colors.textDarkGray,
          textAlign: 'center',
          lineHeight: 32,
        },
        noAssetHint: {
          fontSize: 17,
          color: colors.textTertiary,
          marginTop: 12,
          textAlign: 'center',
          lineHeight: 26,
        },
      }),
    [colors]
  );

export default CompanionContent;
