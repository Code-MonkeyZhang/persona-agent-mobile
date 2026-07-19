/**
 * @file hooks/useKeyboardLayout.ts
 * @description 键盘弹出/收起监听，驱动输入栏的 paddingBottom 避让。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, Keyboard, LayoutAnimation, TextInput } from 'react-native';
import { logger } from '../../lib/logger';

export function useKeyboardLayout(
  textInputViewRef: React.RefObject<TextInput>,
  scrollToBottom: () => void
) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;

  useEffect(() => {
    const showEvent = Platform.select({
      ios: 'keyboardWillShow',
      android: 'keyboardDidShow',
    }) as 'keyboardWillShow' | 'keyboardDidShow';
    const hideEvent = Platform.select({
      ios: 'keyboardWillHide',
      android: 'keyboardDidHide',
    }) as 'keyboardWillHide' | 'keyboardDidHide';

    /** 配置与键盘动画同步的 LayoutAnimation */
    const animate = (duration: number) => {
      const d = (duration > 10 ? duration : 10) * 1.15;
      LayoutAnimation.configureNext({
        duration: d,
        update: { duration: d, type: 'easeInEaseOut' },
      });
    };

    const showListener = Keyboard.addListener(showEvent, (e) => {
      const { height } = e.endCoordinates;
      animate(e.duration);
      setKeyboardHeight(height);
      if (textInputViewRef.current?.isFocused()) {
        scrollToBottomRef.current();
      }
      logger.info(`[Keyboard] show height=${height}`);
    });

    const hideListener = Keyboard.addListener(hideEvent, (e) => {
      animate(e.duration);
      setKeyboardHeight(0);
      logger.info('[Keyboard] hide');
    });

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, [textInputViewRef]);

  /** 延迟 100ms 后聚焦输入框，等待布局完成 */
  const showKeyboard = useCallback(() => {
    setTimeout(() => {
      textInputViewRef.current?.focus();
    }, 100);
  }, [textInputViewRef]);

  return { keyboardHeight, showKeyboard };
}
