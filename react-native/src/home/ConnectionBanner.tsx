/**
 * @file home/ConnectionBanner.tsx
 * @description Home 与 Chat 两页共用的连接态条，四态直映链路。
 *   - 红条连接失败，点本体以当前地址立即重连，右端箭头独立进 Server 改地址
 *   - 蓝条未填地址引导进 Server，点本体与点箭头等价
 *   - 蓝条连接中与重连中转圈过渡，重连由 ws-client 自动进行，不可点
 *   - 绿条已连接亮两秒后压高收起，动画回调摘除并配兜底定时器双保险，重挂载不重播
 *   组件自取导航与连接态，两页宿主直接挂载即可，无需传回调。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { Check, ChevronRight, Link2Off, WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ColorScheme, typography } from '../theme/index.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import { logger } from '../lib/logger';

/** Home 与 Chat 都在根栈内，取两页公共的导航形状即可跳 Server */
type BannerNavigation = NativeStackNavigationProp<
  RouteParamList,
  'Home' | 'Chat'
>;

/** 已连接绿条的停留时长，亮满转收起 */
const CONNECTED_FLASH_MS = 2000;

/** 绿条收起动画时长 */
const COLLAPSE_MS = 300;

/** 收起的兜底摘除时限，略长于动画本身，动画回调被中断的环境也能收干净 */
const COLLAPSE_FALLBACK_MS = 600;

/** 横幅进场动画时长 */
const ENTER_MS = 250;

/** 横幅固定行高与纵向内边距，收起动画把这两项压到零 */
const BANNER_HEIGHT = 52;
const BANNER_PAD_V = 8;

/** 绿条的三段状态，亮起两秒后转收起，动画播完摘除 */
type FlashPhase = 'shown' | 'collapsing' | 'gone';

/** 横幅的视觉分档，同档内的文字切换不重播进场动画 */
type BannerKind = 'flash' | 'transient' | 'noAddress' | 'failed';

const ConnectionBanner: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<BannerNavigation>();
  const status = useConnectionStore((s) => s.status);
  const serverAddress = useConnectionStore((s) => s.serverAddress);
  const styles = createStyles(colors);

  const [flashPhase, setFlashPhase] = useState<FlashPhase>('gone');

  const enterAnim = useRef(new Animated.Value(0)).current;
  const collapseAnim = useRef(new Animated.Value(0)).current;

  const kind: BannerKind =
    status === 'connected'
      ? 'flash'
      : status === 'connecting' || status === 'reconnecting'
      ? 'transient'
      : serverAddress
      ? 'failed'
      : 'noAddress';

  /** 上一次的连接状态，用来区分真实落进已连接与带着已连接状态挂载 */
  const prevStatusRef = useRef(status);

  // 只在亲眼看到状态从非连接变成已连接时亮一次绿条，亮满两秒转收起
  // 页面切换重新挂载时如果连接早就是好的，不重播；中途断连立刻复位让位红蓝条
  useEffect(() => {
    const wasConnected = prevStatusRef.current === 'connected';
    prevStatusRef.current = status;
    if (status !== 'connected') {
      setFlashPhase('gone');
      return;
    }
    if (wasConnected) {
      return;
    }
    setFlashPhase('shown');
    const timer = setTimeout(
      () => setFlashPhase('collapsing'),
      CONNECTED_FLASH_MS
    );
    return () => clearTimeout(timer);
  }, [status]);

  // 收起动画播完由完成回调摘除，回调被中断时由兜底定时器收尾
  useEffect(() => {
    if (flashPhase !== 'collapsing') {
      return;
    }
    collapseAnim.setValue(0);
    Animated.timing(collapseAnim, {
      toValue: 1,
      duration: COLLAPSE_MS,
      useNativeDriver: false,
    }).start((event) => {
      if (event.finished) {
        logger.debug('[ConnectionBanner] green banner collapsed');
        setFlashPhase('gone');
      }
    });
    const fallback = setTimeout(
      () => setFlashPhase('gone'),
      COLLAPSE_FALLBACK_MS
    );
    return () => clearTimeout(fallback);
  }, [flashPhase, collapseAnim]);

  // 每次视觉分档变化重播进场动画，淡入加自上而下八像素落位
  useEffect(() => {
    enterAnim.setValue(0);
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.ease,
      useNativeDriver: true,
    }).start();
  }, [kind, enterAnim]);

  const enterStyle = {
    opacity: enterAnim,
    transform: [
      {
        translateY: enterAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [-8, 0],
        }),
      },
    ],
  };

  const collapseStyle = {
    height: collapseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [BANNER_HEIGHT, 0],
    }),
    paddingTop: collapseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [BANNER_PAD_V, 0],
    }),
    paddingBottom: collapseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [BANNER_PAD_V, 0],
    }),
    opacity: collapseAnim,
  };

  /** 红条本体点击，以当前地址立即重连并重置退避节奏 */
  const retryNow = useCallback(() => {
    const address = useConnectionStore.getState().serverAddress;
    logger.info(`[ConnectionBanner] banner tap, reconnect: ${address}`);
    useConnectionStore.getState().connect(address);
  }, []);

  /** 箭头与未填地址蓝条本体的共同入口，进 Server 页改地址 */
  const goServer = useCallback(() => {
    logger.info('[ConnectionBanner] go Server');
    navigation.navigate('Server');
  }, [navigation]);

  // 绿条内容，亮起与收起两段渲染共用
  const flashContent = (
    <>
      <Check size={18} color={colors.success} />
      <Text style={[styles.text, { color: colors.success }]}>
        {t('home.connected')}
      </Text>
    </>
  );

  if (kind === 'flash') {
    if (flashPhase === 'gone') {
      return null;
    }
    if (flashPhase === 'collapsing') {
      return (
        <Animated.View
          style={[
            styles.container,
            styles.bannerFlash,
            styles.collapsing,
            collapseStyle,
          ]}
        >
          {flashContent}
        </Animated.View>
      );
    }
    return (
      <Animated.View
        style={[
          styles.container,
          styles.banner,
          styles.bannerFlash,
          enterStyle,
        ]}
      >
        {flashContent}
      </Animated.View>
    );
  }

  if (kind === 'transient') {
    return (
      <Animated.View
        style={[
          styles.container,
          styles.banner,
          styles.bannerTransient,
          enterStyle,
        ]}
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.text, { color: colors.primary }]}>
          {status === 'reconnecting'
            ? t('connection.reconnecting')
            : t('server.connecting')}
        </Text>
      </Animated.View>
    );
  }

  if (kind === 'noAddress') {
    return (
      <Animated.View style={enterStyle}>
        <TouchableOpacity
          style={[styles.container, styles.banner, styles.bannerTransient]}
          activeOpacity={0.8}
          onPress={goServer}
        >
          <Link2Off size={18} color={colors.primary} />
          <Text style={[styles.text, { color: colors.primary }]}>
            {t('home.connNoAddress')}
          </Text>
          <ServerChevron color={colors.primary} onPress={goServer} />
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={enterStyle}>
      <TouchableOpacity
        style={[styles.container, styles.banner, styles.bannerStalled]}
        activeOpacity={0.8}
        onPress={retryNow}
      >
        <WifiOff size={18} color={colors.primaryForeground} />
        <Text style={[styles.text, styles.textStalled]}>
          {t('home.connFailed')}
        </Text>
        <ServerChevron color={colors.primaryForeground} onPress={goServer} />
      </TouchableOpacity>
    </Animated.View>
  );
};

/**
 * 右端进服务器页的箭头入口，颜色随所在横幅的文字色。
 * 嵌在本体的 TouchableOpacity 内，RN 内层触摸先于外层命中，点它只开页面不触发本体动作。
 */
function ServerChevron({
  color,
  onPress,
}: {
  color: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      accessibilityLabel={t('home.server')}
      accessibilityRole="button"
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 0 }}
      onPress={onPress}
    >
      <ChevronRight size={24} color={color} />
    </TouchableOpacity>
  );
}

/** 连接态条样式工厂，红蓝绿各态共用同一行高避免状态切换时跳动 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    banner: {
      minHeight: BANNER_HEIGHT,
      paddingVertical: BANNER_PAD_V,
    },
    bannerTransient: {
      backgroundColor: colors.primarySelectedBackground,
    },
    bannerStalled: {
      backgroundColor: colors.error,
    },
    bannerFlash: {
      backgroundColor: colors.successBackground,
    },
    /** 收起中的绿条，高度与内边距由动画值接管并裁掉溢出内容 */
    collapsing: {
      overflow: 'hidden',
    },
    text: {
      flex: 1,
      ...typography.body,
      fontWeight: '600',
    },
    textStalled: {
      color: colors.primaryForeground,
    },
  });

export default ConnectionBanner;
