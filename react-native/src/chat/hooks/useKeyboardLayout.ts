/**
 * @file hooks/useKeyboardLayout.ts
 * @description 键盘弹出/收起监听，驱动输入栏的 paddingBottom 避让。
 *   避让动画由 reanimated 在 UI 线程驱动，LayoutAnimation 在 Fabric 的 iOS 侧不生效。
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, TextInput } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { logger } from '../../lib/logger';

/** 键盘弹出时输入栏与键盘顶边保留的间距 */
const KEYBOARD_GAP = 8;

/** 事件未携带动画时长时的兜底时长，毫秒 */
const DEFAULT_KEYBOARD_ANIM_MS = 250;

/**
 * 输入栏底部避让量，iOS 随键盘高度抬升且不低于安全区，Android 只切换间距增量。
 * JS 侧计算浮层占位，动画侧在 worklet 中逐帧求值，两处共用同一份公式。
 */
export function keyboardAvoidanceOf(
  keyboardHeight: number,
  insetsBottom: number
): number {
  'worklet';
  return Platform.OS === 'ios'
    ? Math.max(keyboardHeight + KEYBOARD_GAP, insetsBottom)
    : insetsBottom + (keyboardHeight > 0 ? KEYBOARD_GAP : 0);
}

export function useKeyboardLayout(
  textInputViewRef: React.RefObject<TextInput | null>,
  scrollToBottom: () => void,
  insetsBottom: number
) {
  const keyboardHeightValue = useSharedValue(0);

  /** 键盘目标高度，每个事件更新一次，供浮层占位等 JS 侧计算使用 */
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;

  useEffect(() => {
    const isIOS = Platform.OS === 'ios';
    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';

    /**
     * iOS 用事件自带时长驱动到目标高度，曲线贴合键盘先加速后减速的节奏。
     * Android 窗口由系统瞬间改尺寸，这里直接赋值不叠加动画。
     */
    const driveTo = (height: number, duration: number) => {
      setKeyboardHeight(height);
      if (!isIOS) {
        keyboardHeightValue.value = height;
        return;
      }
      keyboardHeightValue.value = withTiming(height, {
        duration: duration > 10 ? duration : DEFAULT_KEYBOARD_ANIM_MS,
        easing: Easing.out(Easing.cubic),
      });
    };

    const showListener = Keyboard.addListener(showEvent, (e) => {
      const { height } = e.endCoordinates;
      driveTo(height, e.duration);
      if (textInputViewRef.current?.isFocused()) {
        scrollToBottomRef.current();
      }
      logger.info(`[Keyboard] show height=${height} duration=${e.duration}`);
    });

    const hideListener = Keyboard.addListener(hideEvent, (e) => {
      driveTo(0, e.duration);
      logger.info('[Keyboard] hide');
    });

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, [textInputViewRef, keyboardHeightValue]);

  /** 输入栏底部避让，动画值在 UI 线程逐帧求值 */
  const keyboardBottomStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboardAvoidanceOf(keyboardHeightValue.value, insetsBottom),
  }));

  return { keyboardBottomStyle, keyboardHeight };
}
