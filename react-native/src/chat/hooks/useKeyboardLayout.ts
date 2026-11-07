/**
 * @file hooks/useKeyboardLayout.ts
 * @description 键盘避让由 react-native-keyboard-controller 驱动。
 *   库在 UI 线程逐帧供给双端一致的键盘高度，浮层抬升与列表占位共用
 *   同一份动画值逐帧联动，开合全程不再出现占位一次性跳变。
 *   避让全部收进 translateY 纯位移，安全区垫底为静态样式，
 *   动画期浮层内部零布局重排。
 *   安全区避让两端分工，安卓垫在浮层外露出背景，iOS 垫在浮层内由毛玻璃底座收编。
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  Platform,
  TextInput,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { logger } from '../../lib/logger';

/** 键盘弹出时输入栏与键盘顶边保留的间距，抬升后的空白缝，双端一致可见 */
const KEYBOARD_GAP = 8;

/** 间距因子补间时长，毫秒，贴合双端键盘开合动画的量级 */
const GAP_TWEEN_MS = 250;

/**
 * 底部浮层的避让净高，键盘高加间距再与安全区比大小。
 * 动画侧逐帧取值，JS 侧取事件时刻的终态值，同一份口径。
 */
function keyboardAvoidanceOf(
  keyboardHeight: number,
  gapHeight: number,
  insetsBottom: number
): number {
  'worklet';
  return Math.max(keyboardHeight + gapHeight, insetsBottom);
}

export function useKeyboardLayout(
  textInputViewRef: React.RefObject<TextInput | null>,
  scrollToBottom: () => void,
  insetsBottom: number,
  inputBarHeight: number,
  companionBubbleHeight: number
) {
  /** 库驱动的键盘高度动画值，弹出期为负值，取绝对值即真实高度 */
  const { height: keyboardHeightAnimated } = useReanimatedKeyboardAnimation();

  /** 键盘目标高度与可见性，仅在开合事件时刻更新一次，供日志与终态定位使用 */
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

  /** 输入栏与陪伴气泡的实测高度同步进动画侧，布局变化逐帧参与占位计算 */
  const inputBarHeightValue = useSharedValue(inputBarHeight);
  const companionBubbleHeightValue = useSharedValue(companionBubbleHeight);
  useEffect(() => {
    inputBarHeightValue.value = inputBarHeight;
    companionBubbleHeightValue.value = companionBubbleHeight;
    logger.info(
      `[Keyboard] overlay parts inputBar=${inputBarHeight} bubble=${companionBubbleHeight} insets=${insetsBottom}`
    );
  }, [
    inputBarHeight,
    companionBubbleHeight,
    insetsBottom,
    inputBarHeightValue,
    companionBubbleHeightValue,
  ]);

  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;

  /** 键盘弹出且输入框持焦时滚到最新消息，开合各记一条日志带终态避让目标 */
  useEffect(() => {
    const avoidance = keyboardAvoidanceOf(
      keyboardHeight,
      keyboardVisible ? KEYBOARD_GAP : 0,
      insetsBottom
    );
    logger.info(
      `[Keyboard] ${
        keyboardVisible ? 'show' : 'hide'
      } height=${keyboardHeight} avoidance=${avoidance}`
    );
    if (keyboardVisible && textInputViewRef.current?.isFocused()) {
      scrollToBottomRef.current();
    }
  }, [keyboardVisible, keyboardHeight, insetsBottom, textInputViewRef]);

  /** 避让净高的唯一事实源，浮层抬升与列表占位共用，两端逐帧同幅 */
  const avoidance = useDerivedValue(() =>
    keyboardAvoidanceOf(
      Math.abs(keyboardHeightAnimated.value),
      KEYBOARD_GAP * gapFactor.value,
      insetsBottom
    )
  );

  /** 浮层整体抬升，避让净高减安全区即位移量，纯 transform 不触发布局 */
  const keyboardLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(avoidance.value - insetsBottom) }],
  }));

  /** 列表底部占位，输入栏加气泡加避让净高，与浮层抬升同一份动画值联动 */
  const overlaySpacerStyle = useAnimatedStyle(() => ({
    height:
      inputBarHeightValue.value +
      companionBubbleHeightValue.value +
      avoidance.value,
  }));

  /** 浮层视觉占位总高的终态值，事件时刻一次跳变，供回底按钮等 JS 侧定位 */
  const overlayHeight =
    inputBarHeight +
    companionBubbleHeight +
    keyboardAvoidanceOf(keyboardHeight, KEYBOARD_GAP, insetsBottom);

  /** 安卓避让垫在浮层外露出背景，iOS 垫在浮层内由毛玻璃底座收编，静态不参与动画 */
  const isAndroid = Platform.OS === 'android';
  const fibInsetStyle = useMemo<StyleProp<ViewStyle>>(
    () =>
      isAndroid
        ? { marginBottom: insetsBottom }
        : { paddingBottom: insetsBottom },
    [isAndroid, insetsBottom]
  );

  return {
    keyboardLiftStyle,
    overlaySpacerStyle,
    fibInsetStyle,
    overlayHeight,
  };
}
