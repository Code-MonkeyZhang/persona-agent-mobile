/**
 * @file component/CompanionReplyBubble.tsx
 * @description 陪伴模式下浮在输入框上方的 AI 回复气泡。
 */
import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  Extrapolation,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { ColorScheme, typography } from '../../theme/index';
import EdgeFade, { EDGE_FADE_H } from '../../component/EdgeFade';
import { logger } from '../../lib/logger';

const createBubbleStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    outer: {
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    inner: {
      borderRadius: 24,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.overlayLight,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 4,
    },
    scroll: {
      maxHeight: 160,
    },
    /** 安卓端 style 上的垂直 padding 会让滚动区底部不可达，padding 挂内容容器 */
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
    },
    text: {
      ...typography.content,
      color: colors.textDarkGray,
    },
    thinking: {
      ...typography.bodyLg,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
  });

interface CompanionReplyBubbleProps {
  messageKey: string | undefined;
  text: string;
  isThinking: boolean;
  thinkingText: string;
  colors: ColorScheme;
}

export function CompanionReplyBubble({
  messageKey,
  text,
  isThinking,
  thinkingText,
  colors,
}: CompanionReplyBubbleProps) {
  const styles = createBubbleStyles(colors);
  const scrollY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const viewH = useSharedValue(0);
  const scrollableRef = useRef(false);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // 上缘随已滚开的距离淡入，下缘随剩余滚动余量淡入，滚到头归零
  const topOpacity = useDerivedValue(() =>
    interpolate(scrollY.value, [0, EDGE_FADE_H], [0, 1], Extrapolation.CLAMP)
  );
  const bottomOpacity = useDerivedValue(() =>
    interpolate(
      contentH.value - viewH.value - scrollY.value,
      [0, EDGE_FADE_H],
      [0, 1],
      Extrapolation.CLAMP
    )
  );

  /** 可滚状态翻转时记一条，排查末行滚不到类反馈有据可查 */
  const trackScrollable = useCallback(() => {
    const scrollable = contentH.value > viewH.value;
    if (scrollable !== scrollableRef.current) {
      scrollableRef.current = scrollable;
      logger.debug(
        `[CompanionReplyBubble] scrollable=${scrollable}, contentH=${contentH.value}, viewH=${viewH.value}`
      );
    }
  }, [contentH, viewH]);

  return (
    <Animated.View
      key={messageKey}
      entering={FadeInDown.duration(350)}
      style={styles.outer}
    >
      <View style={styles.inner}>
        {isThinking ? (
          <Text style={styles.thinking}>{thinkingText}</Text>
        ) : (
          <>
            <Animated.ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={scrollHandler}
              onLayout={(event) => {
                viewH.value = event.nativeEvent.layout.height;
                trackScrollable();
              }}
              onContentSizeChange={(_width, height) => {
                contentH.value = height;
                trackScrollable();
              }}
            >
              <Text style={styles.text}>{text}</Text>
            </Animated.ScrollView>
            <EdgeFade edge="top" opacity={topOpacity} bgColor={colors.card} />
            <EdgeFade
              edge="bottom"
              opacity={bottomOpacity}
              bgColor={colors.card}
            />
          </>
        )}
      </View>
    </Animated.View>
  );
}
