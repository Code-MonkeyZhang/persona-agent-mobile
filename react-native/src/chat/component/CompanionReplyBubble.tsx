/**
 * @file component/CompanionReplyBubble.tsx
 * @description 陪伴模式下浮在输入框上方的 AI 回复气泡。
 *   运行期与顶栏时间线同一份 liveRun 驱动，一次只显一条动向居中整句替换，
 *   失败步红字不带圆点，轮末落回回复正文，liveRun 消费前校验归属防其他会话串台。
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  Extrapolation,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { ColorScheme, typography } from '../../theme/index';
import EdgeFade, { EDGE_FADE_H } from '../../component/EdgeFade';
import { useChatStore } from '../../stores/chatStore';
import { Dots, FAIL_RED, liveRunLabel, phaseIcon } from './LiveStrip';
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
    liveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    liveLabel: {
      // 自然宽度不撑满整行，圆点紧跟文字右侧，空间不足先收缩截断
      flexShrink: 1,
      ...typography.caption,
    },
    liveLabelNormal: {
      fontWeight: '500',
      color: '#333333',
    },
    liveLabelRed: {
      fontWeight: '600',
      color: FAIL_RED,
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
  const { t } = useTranslation();
  const styles = createBubbleStyles(colors);
  const liveRun = useChatStore((s) => s.liveRun);
  const displayedSessionId = useChatStore((s) => s.displayedSessionId);
  const scrollY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const viewH = useSharedValue(0);
  const scrollableRef = useRef(false);

  // 运行期动向与顶栏时间线同源，liveRun 归属当前会话时框内只显当前这一步
  const liveOwned = !!liveRun && liveRun.sessionId === displayedSessionId;
  const liveFailed = liveOwned
    ? !!liveRun.steps[liveRun.steps.length - 1]?.failed
    : false;
  const liveLabelText = liveOwned ? liveRunLabel(t, liveRun) : '';
  const LiveIcon = liveOwned ? phaseIcon(liveRun) : null;

  // 每步动向进框时留一条日志，陪伴态反馈缺失时可据此排查数据链路
  useEffect(() => {
    if (liveOwned) {
      logger.debug(`[CompanionReplyBubble] live动向: ${liveLabelText}`);
    }
  }, [liveOwned, liveLabelText]);

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
          liveOwned && LiveIcon ? (
            <View style={styles.liveRow}>
              <LiveIcon size={11} color={colors.primary} />
              <Text
                style={[
                  styles.liveLabel,
                  liveFailed ? styles.liveLabelRed : styles.liveLabelNormal,
                ]}
                numberOfLines={1}
              >
                {liveLabelText}
              </Text>
              {!liveFailed && <Dots />}
            </View>
          ) : (
            <Text style={styles.thinking}>{thinkingText}</Text>
          )
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
