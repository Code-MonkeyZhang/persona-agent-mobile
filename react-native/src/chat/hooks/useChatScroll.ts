/**
 * @file hooks/useChatScroll.ts
 * @description 聊天消息列表的滚动控制：自动滚底、思考面板展开时的逐帧滚动补偿、用户滚动检测。
 */
import { useCallback, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type ScrollEvent,
} from 'react-native-reanimated';
import type { AnimatedList } from 'react-native-gifted-chat/lib/MessagesContainer';
import type { ChatMessage } from '../../types/Chat';
import { ChatStatus } from '../../types/Chat';
import { logger } from '../../lib/logger';
import { PANEL_REVEAL } from '../component/CollapsedThoughtProcess.tsx';

export function useChatScroll(
  chatStatusRef: React.MutableRefObject<ChatStatus>
) {
  const flatListRef = useAnimatedRef<AnimatedList<ChatMessage>>();
  const [userScrolled, setUserScrolled] = useState(false);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const currentScrollOffsetRef = useRef(0);
  const reduceMotion = useReducedMotion();

  // 逐帧补偿三件套，progress 是面板进度动画的镜像，base 与 height 是本次补偿的锚点与行程
  const compensateProgress = useSharedValue(0);
  const compensateBase = useSharedValue(0);
  const compensateHeight = useSharedValue(0);

  /** 将消息列表滚动到顶部（GiftedChat 是倒序的，offset=0 即最新消息） */
  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [flatListRef]);

  /**
   * 记录当前滚动偏移量。
   * gifted-chat v3 列表经 reanimated 派发 onScroll，
   * 事件为官方 ScrollEvent 形态，contentOffset 位于顶层。
   */
  const handleScroll = useCallback((scrollEvent: ScrollEvent) => {
    currentScrollOffsetRef.current = scrollEvent.contentOffset.y;
  }, []);

  /** 用户手动拖拽滚动时标记 userScrolled，暂停自动滚底 */
  const handleUserScroll = useCallback(
    (_: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (chatStatusRef.current === ChatStatus.Running) {
        setUserScrolled(true);
      }
    },
    [chatStatusRef]
  );

  /** 惯性滚动结束后，如果用户在流式输出期间滚动到接近底部，自动回到底部 */
  const handleMomentumScrollEnd = useCallback(
    (endEvent: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (chatStatusRef.current === ChatStatus.Running && userScrolled) {
        const { contentOffset } = endEvent.nativeEvent;
        if (contentOffset.y > 0 && contentOffset.y < 100) {
          scrollToBottom();
        }
      }
    },
    [chatStatusRef, userScrolled, scrollToBottom]
  );

  // 镜像进度每帧换算成列表偏移，倒序列表里该方向滚动把内容向下拉回，与面板高度增长同帧抵消
  useAnimatedReaction(
    () => compensateProgress.value,
    (progress) => {
      scrollTo(
        flatListRef,
        0,
        compensateBase.value + compensateHeight.value * progress,
        false
      );
    },
    [compensateBase, compensateHeight]
  );

  /**
   * 思考面板展开收起的动画起点回调。
   * 面板侧同帧起跑同配置的高度动画，这里以镜像进度逐帧滚动，
   * 高度增长把入口行向上顶多少，滚动就把内容向下拉回多少，入口行视觉静止。
   * 锚点取当前偏移扣除已补偿份额，动画中途反向点按也能对齐。
   */
  const handleReasoningToggle = useCallback(
    (expanded: boolean, height: number) => {
      compensateBase.value =
        currentScrollOffsetRef.current -
        compensateHeight.value * compensateProgress.value;
      compensateHeight.value = height;
      logger.debug(
        `[useChatScroll] reasoning compensate, expanded=${expanded}, height=${height}, base=${compensateBase.value}`
      );
      const target = expanded ? 1 : 0;
      if (reduceMotion) {
        compensateProgress.set(target);
      } else {
        compensateProgress.set(withTiming(target, PANEL_REVEAL));
      }
    },
    [reduceMotion, compensateProgress, compensateBase, compensateHeight]
  );

  return {
    flatListRef,
    userScrolled,
    setUserScrolled,
    contentHeightRef,
    containerHeightRef,
    currentScrollOffsetRef,
    scrollToBottom,
    handleScroll,
    handleUserScroll,
    handleMomentumScrollEnd,
    handleReasoningToggle,
  };
}
