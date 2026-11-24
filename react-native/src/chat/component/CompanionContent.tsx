/**
 * @file CompanionContent.tsx
 * @description 陪伴模式纯展示组件：背景图 + 四层立绘舞台。
 *   舞台分层：外层身体动作 one-shot，中层呼吸可关，内层双图层交叉淡化，气泡独立一层锚挂载点左上角。
 *   换脸的门控、竞态保护与回退逻辑都在 performanceStore 的引擎里，本组件只按 state 渲染，
 *   不做任何 WebSocket 或 API 调用。背景与资源就绪态由 ChatScreen 通过 props 驱动。
 *   动画全部走 reanimated，气泡用 expo-image 直渲包内的动态 webp。
 *   气泡层的思考气泡由生成相位驱动，本组件订阅展示会话的生成状态与思考气泡开关推进引擎，是相位进入引擎的唯一桥接。
 *   聊天页的目标会话由 ChatScreen 经 props 传入，展示会话追上它之前相位不推进。
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type AnimationCallback,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { useTranslation } from 'react-i18next';
import CachedImage from '../../component/CachedImage';
import { getBackgroundImageUrl } from '../../api/server-api.ts';
import { EFFECT_ASSETS } from '../../lib/effect-assets';
import type { MotionName } from '../../lib/performance';
import { usePerformanceStore } from '../../stores/performanceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { deriveLivePhase } from './LiveStrip';
import { ChatStatus } from '../../types/Chat';
import { logger } from '../../lib/logger';
import { useTheme, typography, type ColorScheme } from '../../theme';

interface CompanionContentProps {
  agentId: string;
  serverAddr: string;
  hasAssets: boolean | null;
  bgError: boolean;
  onBgError: () => void;
  /** 情绪气泡相对立绘挂载点左上角的偏移，单位是挂载点宽高的百分比 */
  bubbleOffset: { x: number; y: number };
  /** 聊天页的目标会话，展示会话追上它之前舞台还在承接上一屏，相位不推进 */
  targetSessionId: string;
}

type Layer = 'a' | 'b';

/** 换脸与气泡的淡化时长，两端同一规格 */
const FADE_MS = 300;
/** 呼吸一个循环的时长与起伏幅度，缩放原点取顶部中心 */
const BREATH_MS = 4000;
const BREATH_SCALE = 1.02;
/** 十六张气泡素材统一是 1920 乘 1080，按这个比例由宽度定高 */
const BUBBLE_ASPECT = 1920 / 1080;
/** 弹跳的最高点，幅度克制的上限 */
const BOUNCE_PX = 15;
/** 带回弹感的缓动，弹跳与心跳共用 */
const BOUNCE_EASING = Easing.bezier(0.175, 0.885, 0.32, 1.275);
const SMOOTH_EASING = Easing.inOut(Easing.quad);

/** 一段过渡，时长按桌面端关键帧的百分比乘总时长换算 */
const tween = (
  to: number,
  duration: number,
  easing: WithTimingConfig['easing'] = SMOOTH_EASING,
  callback?: AnimationCallback
) => withTiming(to, { duration, easing }, callback);

/**
 * 动作层的三条变换通道，一个动作只用其中的一部分，没用到的通道立即归位
 * 通道的类型跟着库的约定写成目标值的类型，运行时里面装的是动画对象
 */
type MotionTracks = Partial<Record<'y' | 'scale' | 'rotate', number>>;

/**
 * 四个身体动作的动画序列，与桌面端 perf 前缀的 CSS keyframes 同一组数值
 * 每个动作把播完的回调挂在自己主通道的最后一段上
 */
const MOTION_TRACKS: Record<
  MotionName,
  (done: AnimationCallback) => MotionTracks
> = {
  'happy-bounce': (done) => ({
    y: withSequence(
      tween(-BOUNCE_PX, 228, BOUNCE_EASING),
      tween(0, 372, SMOOTH_EASING, done)
    ),
  }),
  'angry-stomp': (done) => ({
    y: withSequence(
      tween(3, 110),
      tween(0, 110),
      tween(3, 110),
      tween(0, 220, SMOOTH_EASING, done)
    ),
    rotate: withSequence(
      tween(-1.2, 110),
      tween(0, 110),
      tween(1.2, 110),
      tween(0, 220)
    ),
  }),
  'heart-beat': (done) => ({
    scale: withSequence(
      tween(1.04, 224, BOUNCE_EASING),
      tween(1, 144),
      tween(1.03, 144, BOUNCE_EASING),
      tween(1, 288, SMOOTH_EASING, done)
    ),
  }),
  'sad-sink': (done) => ({
    y: withSequence(tween(5, 360), tween(0, 540, SMOOTH_EASING, done)),
    scale: withSequence(tween(0.99, 360), tween(1, 540)),
  }),
};

/**
 * 陪伴内容展示层：背景图、四层立绘舞台、空态。
 * 作为滑动容器的右侧 pane 渲染，演出状态订阅 performanceStore，其余由 ChatScreen 通过 props 驱动。
 */
const CompanionContent = React.memo(function ({
  agentId,
  serverAddr,
  hasAssets,
  bgError,
  onBgError,
  bubbleOffset,
  targetSessionId,
}: CompanionContentProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCompanionStyles(colors);

  const layers = usePerformanceStore((s) => s.layers);
  const active = usePerformanceStore((s) => s.active);
  const aspect = usePerformanceStore((s) => s.aspect);
  const instant = usePerformanceStore((s) => s.instant);
  const failed = usePerformanceStore((s) => s.failed);
  const motion = usePerformanceStore((s) => s.motion);
  const bubble = usePerformanceStore((s) => s.bubble);
  const motionEnded = usePerformanceStore((s) => s.motionEnded);
  const setPhase = usePerformanceStore((s) => s.setPhase);
  const setThinkingEnabled = usePerformanceStore((s) => s.setThinkingEnabled);
  const breathEnabled = useSettingsStore((s) => s.breathEnabled);
  const thinkingEnabled = useSettingsStore((s) => s.thinkingBubbleEnabled);
  const displayedSessionId = useChatStore((s) => s.displayedSessionId);
  const generating = useChatStore(
    (s) => s.sessions[s.displayedSessionId]?.status === ChatStatus.Running
  );
  const liveRun = useChatStore((s) => s.liveRun);
  // 聊天页刚挂载时展示会话可能还停在上一屏，别的会话正在生成也不能让它的思考气泡闪到这里，追上目标会话才按生成态推相位
  // 分片是否在生成是权威信号，liveRun 是带归属的全局单例，归属对不上按空时间线推导，下一个事件到达自然细分
  const phase =
    generating && displayedSessionId === targetSessionId
      ? deriveLivePhase(
          liveRun?.sessionId === displayedSessionId
            ? liveRun
            : { sessionId: displayedSessionId, steps: [] }
        )
      : 'idle';

  const opacityA = useSharedValue(0);
  const opacityB = useSharedValue(0);
  const breathScale = useSharedValue(1);
  const bubbleOpacity = useSharedValue(0);
  /** 动作层的三条变换通道，各自接收一段动画序列 */
  const motionY = useSharedValue(0);
  const motionScale = useSharedValue(1);
  const motionRotate = useSharedValue(0);
  const motionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: motionY.value },
      { scale: motionScale.value },
      { rotate: `${motionRotate.value}deg` },
    ],
  }));

  /**
   * 渲染门控：记下每层实际加载完成的地址，引擎切到的新层加载完成才把着色切过去。
   * 引擎只保证文件已落盘，位图解码到这里才结束，旧图留到那一刻所以不露白。
   */
  const [loadedUrl, setLoadedUrl] = useState<Record<Layer, string>>({
    a: '',
    b: '',
  });
  const [shown, setShown] = useState<Layer>('a');
  const activeLoaded = loadedUrl[active] === layers[active];
  useEffect(() => {
    if (activeLoaded) {
      setShown(active);
    }
  }, [activeLoaded, active]);

  /** 着色层变化时交叉淡化，会话恢复的瞬切把时长压到零，共享值引用稳定放进依赖不触发多余运行 */
  useEffect(() => {
    const config = { duration: instant ? 0 : FADE_MS, easing: Easing.linear };
    opacityA.value = withTiming(shown === 'a' ? 1 : 0, config);
    opacityB.value = withTiming(shown === 'b' ? 1 : 0, config);
  }, [shown, instant, opacityA, opacityB]);

  /** 常驻呼吸四秒一循环，关闭即停并回到恒等变换 */
  useEffect(() => {
    if (breathEnabled) {
      breathScale.value = withRepeat(
        withSequence(
          withTiming(BREATH_SCALE, {
            duration: BREATH_MS / 2,
            easing: SMOOTH_EASING,
          }),
          withTiming(1, { duration: BREATH_MS / 2, easing: SMOOTH_EASING })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(breathScale);
      breathScale.value = withTiming(1, { duration: FADE_MS });
    }
    return () => cancelAnimation(breathScale);
  }, [breathEnabled, breathScale]);

  /**
   * 动作每次从头播，同一动作连点靠 key 递增重播，播完回调引擎归位
   * 完成回调在 UI 线程执行，先赋给变量再传入不会被自动转成 worklet，所以要显式声明指令
   */
  useEffect(() => {
    if (!motion.name) {
      return;
    }
    const done: AnimationCallback = (finished) => {
      'worklet';
      if (finished) {
        runOnJS(motionEnded)();
      }
    };
    const tracks = MOTION_TRACKS[motion.name](done);
    motionY.value = tracks.y ?? 0;
    motionScale.value = tracks.scale ?? 1;
    motionRotate.value = tracks.rotate ?? 0;
  }, [
    motion.key,
    motion.name,
    motionEnded,
    motionY,
    motionScale,
    motionRotate,
  ]);

  /** 气泡到点淡出，淡入由图片组件在加载完成时自己接管 */
  useEffect(() => {
    bubbleOpacity.value = withTiming(bubble.shown ? 1 : 0, {
      duration: FADE_MS,
    });
  }, [bubble.shown, bubbleOpacity]);

  /** 相位推进引擎，思考气泡随之出入场，用 layout effect 是切会话时它要赶在绘制前与瞬切对齐 */
  useLayoutEffect(() => {
    setPhase(phase);
  }, [phase, setPhase]);

  /** 思考气泡开关注入引擎，运行中拨动立即生效 */
  useLayoutEffect(() => {
    setThinkingEnabled(thinkingEnabled);
  }, [thinkingEnabled, setThinkingEnabled]);

  /** 舞台卸载时相位归空闲，思考气泡随之收起，清理函数只在卸载时运行，不随相位变化触发 */
  useLayoutEffect(() => () => setPhase('idle'), [setPhase]);

  const onLayerLoad = useCallback((layer: Layer, url: string) => {
    setLoadedUrl((prev) => ({ ...prev, [layer]: url }));
  }, []);

  const showStage = hasAssets === true && !failed;

  return (
    <View style={styles.container}>
      {hasAssets === true && !bgError && (
        <CachedImage
          source={getBackgroundImageUrl(agentId, serverAddr)}
          style={StyleSheet.absoluteFillObject}
          onLoad={() => logger.info('[Companion] background loaded')}
          onError={() => {
            logger.warn('[Companion] background load failed');
            onBgError();
          }}
          resizeMode="cover"
        />
      )}

      {showStage && (
        /* 立绘挂载点：高度 85% 宽度随宽高比，自身即立绘包围盒，气泡锚它的左上角 */
        <View style={styles.poseLayer} pointerEvents="none">
          <View style={[styles.anchor, { aspectRatio: aspect }]}>
            {/* 外层身体动作，one-shot 播完归位 */}
            <Animated.View style={[StyleSheet.absoluteFillObject, motionStyle]}>
              {/* 中层呼吸，缩放原点顶部中心，关闭后立绘完全静止 */}
              <Animated.View
                style={[
                  StyleSheet.absoluteFillObject,
                  styles.breath,
                  { transform: [{ scale: breathScale }] },
                ]}
              >
                {/* 内层换脸，双图层叠放交叉淡化 */}
                <Animated.View
                  style={[StyleSheet.absoluteFillObject, { opacity: opacityA }]}
                >
                  {layers.a && (
                    <CachedImage
                      source={layers.a}
                      style={StyleSheet.absoluteFillObject}
                      resizeMode="contain"
                      onLoad={() => onLayerLoad('a', layers.a)}
                    />
                  )}
                </Animated.View>
                <Animated.View
                  style={[StyleSheet.absoluteFillObject, { opacity: opacityB }]}
                >
                  {layers.b && (
                    <CachedImage
                      source={layers.b}
                      style={StyleSheet.absoluteFillObject}
                      resizeMode="contain"
                      onLoad={() => onLayerLoad('b', layers.b)}
                    />
                  )}
                </Animated.View>
              </Animated.View>
            </Animated.View>
            {/* 气泡独立一层，不挂动作层里，立绘跳的时候气泡不动，宽取挂载点七成 */}
            {bubble.name && (
              <Animated.View
                style={[
                  styles.bubble,
                  {
                    left: `${bubbleOffset.x}%`,
                    top: `${bubbleOffset.y}%`,
                    opacity: bubbleOpacity,
                  },
                ]}
              >
                <ExpoImage
                  key={bubble.key}
                  source={EFFECT_ASSETS[bubble.name]}
                  style={styles.bubbleImage}
                  contentFit="contain"
                  transition={FADE_MS}
                />
              </Animated.View>
            )}
          </View>
        </View>
      )}

      {hasAssets === false && (
        <View style={styles.centerContent}>
          <Text style={styles.noAssetTitle}>{t('companion.noAssetTitle')}</Text>
          <Text style={styles.noAssetHint}>{t('companion.noAssetHint')}</Text>
        </View>
      )}
    </View>
  );
});

const useCompanionStyles = (colors: ColorScheme) =>
  React.useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.surface,
        },
        poseLayer: {
          position: 'absolute',
          bottom: 40,
          left: 0,
          right: 0,
          height: '85%',
          alignItems: 'center',
        },
        anchor: {
          height: '100%',
          maxWidth: '100%',
        },
        breath: {
          transformOrigin: '50% 0%',
        },
        bubble: {
          position: 'absolute',
          width: '70%',
        },
        bubbleImage: {
          width: '100%',
          aspectRatio: BUBBLE_ASPECT,
        },
        centerContent: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        },
        noAssetTitle: {
          ...typography.bodyLg,
          fontWeight: '600',
          color: colors.textDarkGray,
          textAlign: 'center',
        },
        noAssetHint: {
          ...typography.meta,
          color: colors.textTertiary,
          marginTop: 12,
          textAlign: 'center',
        },
      }),
    [colors]
  );

export default CompanionContent;
