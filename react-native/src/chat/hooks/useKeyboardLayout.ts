/**
 * @file hooks/useKeyboardLayout.ts
 * @description 键盘避让由 react-native-keyboard-controller 驱动。
 *   库在 UI 线程逐帧供给双端一致的键盘高度，底部浮层整体抬升贴住键盘上沿，
 *   间距缝落在浮层之外露出背景，安卓 edge-to-edge 的覆盖式键盘同样适用。
 *   安全区避让两端分工，安卓垫在浮层外露出背景，iOS 垫在浮层内由毛玻璃底座收编。
 */
import { useEffect, useRef } from 'react';
import { Platform, TextInput } from 'react-native';
import {
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { logger } from '../../lib/logger';

/** 键盘弹出时输入栏与键盘顶边保留的间距，抬升后的空白缝，双端一致可见 */
const KEYBOARD_GAP = 8;

/** 间距因子补间时长，毫秒，贴合双端键盘开合动画的量级 */
const GAP_TWEEN_MS = 250;

/**
 * 底部浮层的视觉占位高度，键盘高度加间距再与安全区比大小。
 * 供列表占位与回底按钮等 JS 侧计算使用，与动画侧的抬升量同一份口径。
 */
export function keyboardAvoidanceOf(
  keyboardHeight: number,
  insetsBottom: number
): number {
  'worklet';
  return Math.max(keyboardHeight + KEYBOARD_GAP, insetsBottom);
}

export function useKeyboardLayout(
  textInputViewRef: React.RefObject<TextInput | null>,
  scrollToBottom: () => void,
  insetsBottom: number
) {
  /** 库驱动的键盘高度动画值，弹出期为负值，取绝对值即真实高度 */
  const { height: keyboardHeightAnimated } = useReanimatedKeyboardAnimation();

  /** 键盘目标高度，仅在开合事件时刻更新一次，供浮层占位等 JS 侧计算使用 */
  const keyboardHeight = useKeyboardState((s) => s.height);
  const keyboardVisible = useKeyboardState((s) => s.isVisible);

  /**
   * 间距因子由键盘可见性驱动补间，不取库的原生进度值。
   * OEM 输入法分阶段开窗时末段瞬发不走系统动画，原生进度会静止在零。
   */
  const gapFactor = useSharedValue(0);
  useEffect(() => {
    gapFactor.value = withTiming(keyboardVisible ? 1 : 0, {
      duration: GAP_TWEEN_MS,
    });
  }, [keyboardVisible, gapFactor]);

  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;

  /** 键盘弹出且输入框持焦时滚到最新消息，开合各记一条日志 */
  useEffect(() => {
    logger.info(
      `[Keyboard] ${keyboardVisible ? 'show' : 'hide'} height=${keyboardHeight}`
    );
    if (keyboardVisible && textInputViewRef.current?.isFocused()) {
      scrollToBottomRef.current();
    }
  }, [keyboardVisible, keyboardHeight, textInputViewRef]);

  /** 浮层整体抬升，键盘高加间距乘因子，间距随开合补间，缝在浮层外露出背景 */
  const keyboardLiftStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: -(
          Math.abs(keyboardHeightAnimated.value) +
          KEYBOARD_GAP * gapFactor.value
        ),
      },
    ],
  }));

  /** 安卓避让垫在容器外露出背景，iOS 垫在容器内由毛玻璃底座收编 */
  const isAndroid = Platform.OS === 'android';

  /** 浮层安全区避让，键盘升起处接管底部后逐帧让位归零，闭合时回到安全区全量 */
  const keyboardPaddingStyle = useAnimatedStyle(() => {
    const avoidance = Math.max(
      insetsBottom - Math.abs(keyboardHeightAnimated.value),
      0
    );
    return isAndroid
      ? { marginBottom: avoidance }
      : { paddingBottom: avoidance };
  });

  return { keyboardLiftStyle, keyboardPaddingStyle, keyboardHeight };
}
