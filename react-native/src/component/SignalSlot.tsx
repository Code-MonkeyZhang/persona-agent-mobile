/**
 * @file SignalSlot.tsx
 * @description 会话行与聊天入口卡的运行与未读信号位。
 *   运行中是九宫格波纹,SpinKit cube grid 口径,轮末不在场落成未读实心圆点,
 *   bool 语义不计数,空闲已读透明占位,标题文字不跳动。
 *   运行优先于未读,前台会话的抑制由调用方传入前完成。
 *   动画走 reanimated 原生线程,单个进度值驱动九格错相取缩放,卸载时取消避免泄漏。
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme, ColorScheme } from '../theme/index.ts';

/** 波纹一圈的周期,毫秒 */
const GRID_PERIOD_MS = 1300;
/** 相邻对角格的延迟步长,毫秒 */
const DELAY_STEP_MS = 100;
/** 单格边长,像素,三乘三密铺十二像素 */
const CUBE_SIZE = 4;

interface SignalSlotProps {
  /** 运行中标志,九宫格波纹表达在干活 */
  running: boolean;
  /** 未读标志,bool 不计数,轮末不在场置位,点进会话清除 */
  unread: boolean;
  /** 位置微调透传,入口卡贴右上等场景 */
  style?: StyleProp<ViewStyle>;
}

/**
 * 波纹的单个格子,缩放按相位走三角波,谷底在百分之三十五周期,
 * 峰值减半近似 SpinKit 的零点五基态,相邻对角格错相一个步长。
 */
function GridCube({
  index,
  progress,
}: {
  index: number;
  progress: SharedValue<number>;
}) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const frac = ((col - row) * DELAY_STEP_MS) / GRID_PERIOD_MS;
    const phase = (progress.value - frac + 2) % 1;
    const scale =
      phase < 0.35
        ? 0.5 * (1 - phase / 0.35)
        : phase < 0.7
        ? ((phase - 0.35) / 0.35) * 0.5
        : 0.5;
    return { transform: [{ scale }] };
  });
  return (
    <Animated.View
      style={[styles.cube, style, { backgroundColor: colors.primary }]}
    />
  );
}

export function SignalSlot({ running, unread, style }: SignalSlotProps) {
  const { colors } = useTheme();
  const themeStyles = createStyles(colors);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!running) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: GRID_PERIOD_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [running, progress]);

  return (
    <View style={[themeStyles.slot, style]}>
      {running ? (
        <View style={styles.grid}>
          {Array.from({ length: 9 }, (_, i) => (
            <GridCube key={i} index={i} progress={progress} />
          ))}
        </View>
      ) : (
        unread && <View style={themeStyles.unreadDot} />
      )}
    </View>
  );
}

/** 波纹与未读共用的静态样式,格色经主题注入 */
const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: CUBE_SIZE * 3,
  },
  cube: {
    width: CUBE_SIZE,
    height: CUBE_SIZE,
    borderRadius: 1,
  },
});

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    slot: {
      width: 24,
      height: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** 未读实心点,不带光晕 */
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
  });
