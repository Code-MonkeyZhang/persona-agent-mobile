/**
 * @file hooks/useChatScroll.ts
 * @description 聊天消息列表的滚动控制：自动滚底、Reasoning 展开时位置保持、用户滚动检测。
 */
import { useState, useRef, useCallback } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import type { ChatMessage } from '../../types/Chat';
import { ChatStatus } from '../../types/Chat';

export function useChatScroll(
  chatStatusRef: React.MutableRefObject<ChatStatus>
) {
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const currentScrollOffsetRef = useRef(0);

  /** 将消息列表滚动到顶部（GiftedChat 是倒序的，offset=0 即最新消息） */
  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  /**
   * 将消息列表向上或向下偏移指定高度，用于展开/收起 Reasoning 区块时保持视觉位置不跳动。
   */
  const scrollUpByHeight = useCallback(
    (expanded: boolean, height: number, animated: boolean) => {
      if (flatListRef.current) {
        const newOffset =
          currentScrollOffsetRef.current + (expanded ? height : -height);
        flatListRef.current.scrollToOffset({ offset: newOffset, animated });
      }
    },
    []
  );

  /** 记录当前滚动偏移量 */
  const handleScroll = useCallback(
    (scrollEvent: NativeSyntheticEvent<NativeScrollEvent>) => {
      currentScrollOffsetRef.current = scrollEvent.nativeEvent.contentOffset.y;
    },
    []
  );

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

  /** Reasoning 区块展开/收起时调整滚动位置 */
  const handleReasoningToggle = useCallback(
    (expanded: boolean, height: number, animated: boolean) => {
      scrollUpByHeight(expanded, height, animated);
    },
    [scrollUpByHeight]
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
