/**
 * @file component/EdgeFade.tsx
 * @description 滚动容器上下缘渐隐条，思考面板与陪伴气泡共用。
 */
import React, { memo, useId } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/** 渐隐带高度，也是透明度随滚动距离拉满的行程 */
export const EDGE_FADE_H = 18;

/**
 * 上下缘渐隐条，把滚动内容向宿主底色淡出，圆角与贴边由宿主容器裁剪。
 * 透明度共享值由滚动位置连续推导，对应方向还有未看内容时淡入，滚到头淡出。
 */
const EdgeFade = memo(function ({
  edge,
  opacity,
  bgColor,
}: {
  edge: 'top' | 'bottom';
  opacity: SharedValue<number>;
  bgColor: string;
}) {
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // 多实例同屏时固定 ID 会撞渐变定义，useId 保证唯一且去掉特殊字符保 url 引用安全
  const gradientId = `edge-fade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // 上缘从宿主顶向下淡出，下缘从宿主底向上淡出
  const from = edge === 'top' ? '0' : '1';
  const to = edge === 'top' ? '1' : '0';
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.fadeBar,
        edge === 'top' ? styles.fadeTop : styles.fadeBottom,
        style,
      ]}
    >
      <Svg width="100%" height={EDGE_FADE_H}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1={from} x2="0" y2={to}>
            <Stop offset="0" stopColor={bgColor} stopOpacity="1" />
            <Stop offset="1" stopColor={bgColor} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height={EDGE_FADE_H}
          fill={`url(#${gradientId})`}
        />
      </Svg>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  /** 渐隐条贴宿主内缘铺满宽度，宿主边框 1，圆角由宿主裁剪 */
  fadeBar: {
    position: 'absolute',
    left: 1,
    right: 1,
    height: EDGE_FADE_H,
  },
  fadeTop: {
    top: 0,
  },
  fadeBottom: {
    bottom: 0,
  },
});

export default EdgeFade;
