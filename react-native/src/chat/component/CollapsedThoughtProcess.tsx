/**
 * @file CollapsedThoughtProcess.tsx
 * @description 消息内思考过程，与顶栏时间线同一套行语言。
 *   - 入口透明无底色，文案恒为思考过程不带步数，失败不改色
 *   - 展开收起共用一个进度动画，裁剪高度、面板透明度与入口箭头随进度推进
 *   - 动画起点的同一时刻回调宿主，宿主镜像进度逐帧滚动列表，入口行视觉静止
 *   - 展开后是带框面板，内容超上限内部滚动，无滚动条，上下缘按剩余内容渐隐
 *   - 行纯展示两行截断不可点，详情弹层只在桌面端
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ChevronRight, Lightbulb, XCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { Thought } from '../../types/Thought';
import { phraseForThought, toolIcon, ROW_ICON, FAIL_RED } from './LiveStrip';
import { useTheme, typography } from '../../theme';
import { logger } from '../../lib/logger';

interface CollapsedThoughtProcessProps {
  steps: Thought[];
  onToggle?: (expanded: boolean, height: number) => void;
}

/** 面板内竖向连线色，取自设计文档与桌面实现 */
const CONNECTOR = '#c3cfdf';

/** 面板内容高度上限，超出走内部滚动 */
const PANEL_MAX_H = 250;

/** 面板纵向装饰高，上下边框各 1 加上下内边距各 8，与 panel 样式保持同步 */
const PANEL_CHROME = 18;

/** 滚动区高度上限，面板总高守 PANEL_MAX_H，扣除纵向装饰高 */
const SCROLL_MAX_H = PANEL_MAX_H - PANEL_CHROME;

/** 渐隐带高度，也是透明度随滚动距离拉满的行程 */
const FADE_H = 18;

/**
 * 展开收起的进度动画配置。
 * 宿主滚动补偿必须镜像同一份配置，两路动画同帧起跑同值推进才能逐帧抵消。
 */
export const PANEL_REVEAL: WithTimingConfig = {
  duration: 240,
  easing: Easing.out(Easing.cubic),
};

/**
 * 单条步骤行，与时间线的行语言同构
 * 前置位身份图标，工具行走自然语言动向句，思考行走正文灰不斜体
 * 失败行整句红字紧跟 circle-x，末行不垂线且收窄下留白与桌面同口径
 */
const ThoughtItem = memo(function ({
  thought,
  isLast,
}: {
  thought: Thought;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const isTool = thought.type === 'tool_use';
  const isErrorType = thought.type === 'error';
  const isFailed = isTool && !!(thought.isError || thought.toolResult?.isError);
  const Icon = isTool
    ? toolIcon(thought.toolName || '')
    : isErrorType
    ? XCircle
    : Lightbulb;
  const iconColor = isErrorType || isFailed ? FAIL_RED : ROW_ICON;
  const summary = phraseForThought(t, thought);
  const textColor = isErrorType || isFailed ? FAIL_RED : colors.textSecondary;

  return (
    <View style={[styles.itemRow, isLast && styles.itemRowLast]}>
      {!isLast && <View style={styles.connector} />}
      <Icon size={11} color={iconColor} />
      {isFailed ? (
        // 失败行主文字不撑满整行，标记贴着文字尾部
        <View style={styles.failRow}>
          <Text style={[styles.rowText, { color: FAIL_RED }]} numberOfLines={2}>
            {summary}
          </Text>
          <XCircle size={11} color={FAIL_RED} />
        </View>
      ) : (
        <Text style={[styles.rowText, { color: textColor }]} numberOfLines={2}>
          {summary}
        </Text>
      )}
    </View>
  );
});

/**
 * 面板上下缘渐隐条，颜色取面板底色，把步骤文字向底色淡出。
 * 透明度共享值由滚动位置连续推导，对应方向还有未看内容时淡入，滚到头淡出。
 */
const EdgeFade = memo(function ({
  edge,
  opacity,
}: {
  edge: 'top' | 'bottom';
  opacity: SharedValue<number>;
}) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const gradientId = `thought-fade-${edge}`;
  // 上缘从面板顶向下淡出，下缘从面板底向上淡出
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
      <Svg width="100%" height={FADE_H}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1={from} x2="0" y2={to}>
            <Stop offset="0" stopColor={colors.surface} stopOpacity="1" />
            <Stop offset="1" stopColor={colors.surface} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height={FADE_H}
          fill={`url(#${gradientId})`}
        />
      </Svg>
    </Animated.View>
  );
});

/**
 * 展开面板本体，带框步骤列表容器。
 * 滚动区挂显式高度，由内容量高驱动并与裁剪层解耦，裁剪层的高度动画不牵连滚动区量高，
 * 首量之前按上限兜底，做法与顶栏时间线面板一致。
 * 量高上报同样由内容高驱动，内容高一到面板总高就是确定值，取小挂高加纵向装饰高直接算出。
 * 不用面板 onLayout 做信号，内容超上限时兜底高度与最终高度相同，onLayout 不会第二次到达。
 * 内容超上限内部滚动且不显示滚动条，滚动位置驱动上下缘渐隐。
 */
const ThoughtPanel = memo(function ({
  steps,
  onMeasure,
}: {
  steps: Thought[];
  onMeasure: (height: number) => void;
}) {
  const { colors } = useTheme();
  const scrollY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const viewH = useSharedValue(0);
  // 内容量高走 state，驱动滚动区显式高度与量高上报
  const [scrollContentH, setScrollContentH] = useState(0);

  useEffect(() => {
    if (scrollContentH > 0) {
      onMeasure(Math.min(scrollContentH, SCROLL_MAX_H) + PANEL_CHROME);
    }
  }, [scrollContentH, onMeasure]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // 上缘随已滚开的距离淡入，下缘随剩余滚动余量淡入，滚到头归零
  const topOpacity = useDerivedValue(() =>
    interpolate(scrollY.value, [0, FADE_H], [0, 1], Extrapolation.CLAMP)
  );
  const bottomOpacity = useDerivedValue(() =>
    interpolate(
      contentH.value - viewH.value - scrollY.value,
      [0, FADE_H],
      [0, 1],
      Extrapolation.CLAMP
    )
  );

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Animated.ScrollView
        style={[
          styles.scroll,
          {
            height:
              scrollContentH > 0
                ? Math.min(scrollContentH, SCROLL_MAX_H)
                : SCROLL_MAX_H,
          },
        ]}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        onLayout={(event) => {
          viewH.value = event.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_width, height) => {
          contentH.value = height;
          setScrollContentH(height);
        }}
      >
        {steps.map((thought, index) => (
          <ThoughtItem
            key={`${thought.id}-${index}`}
            thought={thought}
            isLast={index === steps.length - 1}
          />
        ))}
      </Animated.ScrollView>
      <EdgeFade edge="top" opacity={topOpacity} />
      <EdgeFade edge="bottom" opacity={bottomOpacity} />
    </View>
  );
});

/** 折叠的思考过程展示组件 */
function CollapsedThoughtProcess({
  steps,
  onToggle,
}: CollapsedThoughtProcessProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const expandedRef = useRef(false);
  const pendingRevealRef = useRef(false);
  const targetHRef = useRef(0);

  const reveal = useSharedValue(0);
  const panelH = useSharedValue(0);

  const clipStyle = useAnimatedStyle(() => ({
    height: panelH.value,
    opacity: reveal.value,
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${90 * reveal.value}deg` }],
  }));

  // text 行由气泡正文承担不进面板，与时间线同一过滤口径
  const visible = steps.filter((th) => th.type !== 'text');

  const startReveal = useCallback(
    (next: boolean) => {
      const target = targetHRef.current;
      if (reduceMotion) {
        reveal.set(next ? 1 : 0);
        panelH.set(next ? target : 0);
      } else {
        reveal.set(withTiming(next ? 1 : 0, PANEL_REVEAL));
        panelH.set(withTiming(next ? target : 0, PANEL_REVEAL));
      }
      // 动画起点回调宿主，宿主镜像进度逐帧滚动补偿
      onToggle?.(next, target);
    },
    [reduceMotion, reveal, panelH, onToggle]
  );

  const handleMeasure = useCallback(
    (height: number) => {
      targetHRef.current = height;
      if (pendingRevealRef.current) {
        pendingRevealRef.current = false;
        // 量高落地时用户可能已快速点回收起，只在仍要展开时起动画
        if (expandedRef.current) {
          logger.debug(`[ThoughtPanel] measured, targetH=${height}`);
          startReveal(true);
        }
      } else if (expandedRef.current) {
        // 展开中内容继续增长，裁剪高度跟随放大
        panelH.set(
          reduceMotion
            ? targetHRef.current
            : withTiming(targetHRef.current, PANEL_REVEAL)
        );
      }
    },
    [reduceMotion, panelH, startReveal]
  );

  if (visible.length === 0) {
    return null;
  }

  const handleToggle = () => {
    const next = !expandedRef.current;
    expandedRef.current = next;
    setExpanded(next);
    logger.debug(
      `[ThoughtPanel] toggle, expanded=${next}, steps=${visible.length}, targetH=${targetHRef.current}`
    );
    if (next && !mounted) {
      // 首次展开先挂载量高，onLayout 回来后再起动画
      pendingRevealRef.current = true;
      setMounted(true);
      return;
    }
    startReveal(next);
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.entryBtn}
        activeOpacity={0.6}
        onPress={handleToggle}
        accessibilityState={{ expanded }}
      >
        <Animated.View style={chevronStyle}>
          <ChevronRight size={11} color={colors.textTertiary} />
        </Animated.View>
        <Text style={[styles.entryText, { color: colors.textSecondary }]}>
          {t('thought.entry')}
        </Text>
      </TouchableOpacity>

      {mounted && (
        <Animated.View
          style={[styles.clip, clipStyle]}
          pointerEvents={expanded ? 'auto' : 'none'}
          accessibilityElementsHidden={!expanded}
        >
          <ThoughtPanel steps={visible} onMeasure={handleMeasure} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 6,
    marginBottom: 6,
    marginLeft: 2,
  },
  entryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  entryText: {
    ...typography.caption,
  },
  /** 动画裁剪层，高度与透明度由共享值驱动，收起后内容留在树中保持量高 */
  clip: {
    marginTop: 4,
    overflow: 'hidden',
  },
  panel: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  scroll: {
    paddingHorizontal: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 12,
    paddingLeft: 4,
    paddingRight: 4,
  },
  /** 末行收窄下留白，单条步骤上下各 12 居中，与桌面端同口径 */
  itemRowLast: {
    paddingBottom: 4,
  },
  rowText: {
    flex: 1,
    ...typography.caption,
  },
  failRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  connector: {
    position: 'absolute',
    left: 9,
    top: 17,
    bottom: -4,
    width: 1.5,
    borderRadius: 1,
    backgroundColor: CONNECTOR,
  },
  /** 渐隐条贴面板内缘铺满宽度，圆角由面板裁剪 */
  fadeBar: {
    position: 'absolute',
    left: 1,
    right: 1,
    height: FADE_H,
  },
  fadeTop: {
    top: 0,
  },
  fadeBottom: {
    bottom: 0,
  },
});

export default memo(CollapsedThoughtProcess);
