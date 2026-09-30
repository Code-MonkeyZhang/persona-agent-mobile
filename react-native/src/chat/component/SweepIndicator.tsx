/**
 * @file SweepIndicator.tsx
 * @description 生成中的扫动条。
 *   3 像素高轨道加圆角药丸，药丸沿轨道 1.8 秒无限往返，
 *   会话运行期间挂在 Chat 头部横幅之下，回合结束由宿主卸载。
 *   规格取自 demo 的扫动条，药丸用纯色实现不引入渐变库。
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../../theme/index.ts';
import { logger } from '../../lib/logger';

/** 单程扫动时长，毫秒 */
const SWEEP_DURATION_MS = 1800;
/** 药丸宽度占轨道宽度的比例 */
const PILL_WIDTH_RATIO = 0.45;
/** 药丸位移区间，按药丸自身宽度的比例表达，起终点都落在轨道外 */
const SWEEP_FROM_RATIO = -0.6;
const SWEEP_TO_RATIO = 2.22;

export function SweepIndicator() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const translateX = useSharedValue(0);
  const styles = createStyles(colors);

  useEffect(() => {
    logger.info('[SweepIndicator] mounted');
    return () => {
      cancelAnimation(translateX);
      logger.info('[SweepIndicator] unmounted');
    };
  }, [translateX]);

  /**
   * 轨道量宽后启动往返扫动。
   * 量宽只发生一次，组件由宿主条件挂载，无需处理重启。
   */
  const handleTrackLayout = ({
    nativeEvent: {
      layout: { width },
    },
  }: {
    nativeEvent: { layout: { width: number } };
  }) => {
    const pillWidth = width * PILL_WIDTH_RATIO;
    translateX.value = SWEEP_FROM_RATIO * pillWidth;
    translateX.value = withRepeat(
      withTiming(SWEEP_TO_RATIO * pillWidth, {
        duration: SWEEP_DURATION_MS,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true
    );
  };

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      style={styles.track}
      accessibilityLabel={t('chat.generating')}
      onLayout={handleTrackLayout}
    >
      <Animated.View
        style={[
          styles.pill,
          pillStyle,
          { width: `${PILL_WIDTH_RATIO * 100}%` },
        ]}
      />
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    track: {
      height: 3,
      overflow: 'hidden',
      backgroundColor: colors.primarySelectedBackground,
    },
    pill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      borderRadius: 2,
      backgroundColor: colors.primary,
    },
  });
