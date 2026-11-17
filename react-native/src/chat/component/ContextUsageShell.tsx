/**
 * @file ContextUsageShell.tsx
 * @description 输入条按钮行的上下文占用小壳。
 *
 * 壳形 48 乘 26 描边圆角矮胖壳，百分比数字居中带百分号对齐桌面端，色底按占用宽度铺开，
 * 色阶三档随占用走高，与数字同色。轻点先触感再触发手动压缩，压缩全程禁点，
 * 数字与色底让位给居中转圈当作回执，转圈由压缩状态驱动跟随全程，终态失败换红色
 * 感叹号停留三秒再翻回数字，描边不参与。占用跨整数边界的变动走
 * 600 毫秒匀速补间，取整同数的微变直接落定，取整后的数字作 SharedValue 直接
 * 进 Animated.Text 的 children，文字在 UI 线程逐帧更新不经 JS 线程不触发
 * React 重渲染。快照缺失降级图标壳，点按照常压缩。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AlertCircle, Loader2, Minimize2 } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { triggerCompression } from '../../api/server-api.ts';
import {
  getServerAddress,
  getServerAgentId,
} from '../../storage/StorageUtils.ts';
import { trigger } from '../util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import { logger } from '../../lib/logger';
import { useChatStore } from '../../stores/chatStore.ts';
import { NEW_CHAT_SESSION } from '../../stores/sessionStore.ts';
import { sameRoundedPercent } from '../util/usage-math.ts';
import { typography } from '../../theme/index.ts';

/** 占用数字变动的补间时长毫秒，涨落双向同款 */
const TWEEN_MS = 600;

/** 失败红色感叹号在小壳上的停留时长毫秒，到点翻回数字 */
const FAIL_MARK_MS = 3000;

/** 色阶三档，九成及以上红，七成到九成琥珀，其余 iOS 蓝，色底与数字同色 */
function toneColor(percent: number): string {
  'worklet';
  if (percent >= 90) return '#ff4444';
  if (percent >= 70) return '#ffbb33';
  return '#007AFF';
}

/**
 * 上下文占用小壳，挂在输入条按钮行加号旁，读当前会话的占用快照与压缩运行态。
 * 数字缺失降级图标壳，新建会话无服务端身份时整壳隐藏。
 */
export function ContextUsageShell() {
  const { t } = useTranslation();
  const sessionId = useChatStore((s) => s.displayedSessionId);
  const snapshot = useChatStore(
    (s) => s.usageSnapshots.get(s.displayedSessionId) ?? null
  );
  const compression = useChatStore(
    (s) => s.compressionStates.get(s.displayedSessionId) ?? null
  );

  const hasUsage = snapshot != null && snapshot.window > 0;
  const compressing =
    compression?.phase === 'running' || compression?.phase === 'retry';
  const failedAt = compression?.failedAt ?? null;

  const pct = useSharedValue(0);
  const spin = useSharedValue(0);
  const sessionRef = useRef<string | null>(null);
  const prevUsedRef = useRef<number | null>(null);
  const prevWindowRef = useRef(0);

  useEffect(() => {
    if (!snapshot || snapshot.window <= 0) return;
    const isSwitch =
      sessionRef.current !== sessionId ||
      prevWindowRef.current !== snapshot.window;
    sessionRef.current = sessionId;
    const prevUsed = prevUsedRef.current;
    prevUsedRef.current = snapshot.used;
    prevWindowRef.current = snapshot.window;
    // 会话或窗口切换直落数字，取整后同百分比的微变直接落定，都不播补间
    if (
      isSwitch ||
      prevUsed == null ||
      prevUsed === snapshot.used ||
      sameRoundedPercent(prevUsed, snapshot.used, snapshot.window)
    ) {
      cancelAnimation(pct);
      pct.value = (snapshot.used / snapshot.window) * 100;
      return;
    }
    pct.value = withTiming((snapshot.used / snapshot.window) * 100, {
      duration: TWEEN_MS,
      easing: Easing.linear,
    });
  }, [snapshot, sessionId, pct]);

  // 压缩回执转圈，UI 线程线性匀速循环旋转，压缩结束归零
  useEffect(() => {
    if (compressing) {
      spin.value = withRepeat(
        withTiming(360, { duration: 900, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
  }, [compressing, spin]);

  // 失败回执由 failedAt 时间戳驱动，亮三秒红色感叹号后翻回数字
  // 过期时间戳不亮，防会话切换或重挂载撞上旧回执
  const [failVisible, setFailVisible] = useState(false);
  useEffect(() => {
    if (failedAt == null || Date.now() - failedAt > FAIL_MARK_MS) {
      setFailVisible(false);
      return;
    }
    setFailVisible(true);
    logger.debug(
      `[usage-shell] fail mark shown, session=${sessionId} failedAt=${failedAt}`
    );
    const id = setTimeout(
      () => setFailVisible(false),
      FAIL_MARK_MS - (Date.now() - failedAt)
    );
    return () => clearTimeout(id);
  }, [failedAt, sessionId]);

  // 转圈颜色取当前档位，压缩期间数字与色底隐去，档位跟随最近一次占用
  const tone = toneColor(
    hasUsage && snapshot ? (snapshot.used / snapshot.window) * 100 : 0
  );

  // 文案恒整数拼百分号，补间只作用于底层数值与色底，取整后的整串作 SharedValue
  // 直接进 Animated.Text 的 children，文字在 UI 线程逐帧更新不经 React 重渲染
  const label = useDerivedValue(() => `${Math.round(pct.value)}%`);
  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(100, pct.value)}%`,
    backgroundColor: toneColor(pct.value),
  }));
  const numStyle = useAnimatedStyle(() => ({
    color: toneColor(pct.value),
  }));
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  const compressNow = useCallback(async () => {
    if (compressing || !sessionId || sessionId === NEW_CHAT_SESSION) return;
    trigger(HapticFeedbackTypes.impactMedium);
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      useChatStore.getState().showNotice('chat.notConnected');
      return;
    }
    try {
      await triggerCompression(address, agentId, sessionId);
      logger.info(
        `[usage-shell] manual compression accepted, session=${sessionId}`
      );
    } catch (e) {
      logger.warn(
        `[usage-shell] manual compression failed: ${
          e instanceof Error ? e.message : e
        }`
      );
      useChatStore.getState().showNotice('chat.compressFailed');
    }
  }, [compressing, sessionId]);

  if (!sessionId || sessionId === NEW_CHAT_SESSION) {
    return null;
  }

  return (
    <Pressable
      onPress={compressNow}
      disabled={compressing}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t('chat.compressAction')}
      style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
    >
      <View style={styles.shell}>
        {/* 内容层三态，压缩中数字与色底让位给居中转圈，失败亮红色感叹号三秒，描边在层外保持静止 */}
        <View style={styles.content}>
          {compressing ? (
            <Animated.View style={spinStyle}>
              <Loader2 size={14} color={tone} />
            </Animated.View>
          ) : failVisible ? (
            <AlertCircle size={14} color="#ff4444" />
          ) : (
            <>
              {hasUsage && <Animated.View style={[styles.fill, fillStyle]} />}
              {hasUsage ? (
                <Animated.Text
                  style={[styles.num, numStyle]}
                  allowFontScaling={false}
                >
                  {label}
                </Animated.Text>
              ) : (
                <Minimize2 size={14} color="#8E8E93" />
              )}
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    padding: 4,
  },
  pressed: {
    opacity: 0.6,
  },
  /** 描边圆角矮胖壳，48 乘 26，描边静止不参与回执切换 */
  shell: {
    width: 48,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#e3e3e6',
    overflow: 'hidden',
  },
  content: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 色底铺占用宽度，低透明与数字同色 */
  fill: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.16,
  },
  num: {
    ...typography.caption,
    fontWeight: '600',
    // 等宽数字对齐桌面端与 Demo 的 tabular-nums，补间步进时整串宽度不抖
    fontVariant: ['tabular-nums'],
  },
});
