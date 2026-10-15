/**
 * @file AppSurface.tsx
 * @description Agent App 全屏 WebView 页面。Stack screen 无原生头走沉浸式，
 *   PhoneAppBar 实体占位居顶，内容从 header 下沿开始排，左钮返回上一屏，右钮回小手机桌面。
 *   加载期间顶栏下挂游走进度线，失败时红条状态条点按重载。
 *   关即卸载 WebView，重开重载（无状态约定）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WebView, type WebViewProps } from 'react-native-webview';
import { useTranslation } from 'react-i18next';
import { useAppPanelStore } from '../../stores/appPanelStore';
import { getServerAddress } from '../../storage/StorageUtils.ts';
import { useTheme } from '../../theme/index.ts';
import { logger } from '../../lib/logger';
import AppTile from './AppTile.tsx';
import PhoneAppBar from './PhoneAppBar.tsx';
import PhoneStatusStrip from './PhoneStatusStrip.tsx';
import type { RouteParamList } from '../../types/RouteTypes.ts';

/** WebView 命令式方法子集，用于 ref 调用 */
interface WebViewHandle {
  reload: () => void;
}

/**
 * react-native-webview 的 index.d.ts 用 `class WebView<P = undefined>` 泛型声明，
 * P 默认值导致 JSX props 推断为 never，此处转回 ForwardRefExoticComponent 恢复正常。
 */
const RnWebView = WebView as unknown as React.ForwardRefExoticComponent<
  WebViewProps & React.RefAttributes<WebViewHandle>
>;

const TAG = '[AppSurface]';

type AppSurfaceNav = NativeStackNavigationProp<RouteParamList, 'AppSurface'>;

/**
 * 顶栏下的游走进度线。轨道宽度经 onLayout 量得后让滑块循环平移，
 * 与加载进度数值无关，只在途与不在途两种观感。
 */
function ProgressLine() {
  const { colors } = useTheme();
  const slide = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    if (trackWidth === 0) {
      return;
    }
    const anim = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [slide, trackWidth]);
  const thumbWidth = trackWidth * 0.38;
  const thumbStyle = [
    styles.progressThumb,
    { backgroundColor: colors.primary },
    {
      width: thumbWidth,
      transform: [
        {
          translateX: slide.interpolate({
            inputRange: [0, 1],
            outputRange: [-thumbWidth, trackWidth],
          }),
        },
      ],
    },
  ];
  return (
    <View
      style={styles.progressTrack}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={thumbStyle} />
    </View>
  );
}

const AppSurface: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<AppSurfaceNav>();
  const currentAppId = useAppPanelStore((s) => s.currentAppId);
  const apps = useAppPanelStore((s) => s.apps);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const webViewRef = useRef<WebViewHandle>(null);

  const serverAddress = getServerAddress();

  useEffect(() => {
    logger.info(`${TAG} mount: ${currentAppId}`);
  }, [currentAppId]);

  if (!currentAppId) {
    return null;
  }

  // 药丸标题用显示名，apps 未就绪时兜底机器键
  const currentApp = apps.find((a) => a.name === currentAppId);
  const displayName = currentApp?.displayName ?? currentAppId;

  const uri = `${serverAddress}/apps/${currentAppId}/mobile`;

  /** 左钮返回上一屏，与原生返回保持同一栈语义 */
  const handleBack = () => {
    logger.info(`${TAG} back pressed`);
    navigation.goBack();
  };

  /** 右钮直回小手机桌面 */
  const handleGrid = () => {
    logger.info(`${TAG} grid pressed`);
    navigation.replace('AppLauncher');
  };

  /** 红条点按重载页面 */
  const handleReload = () => {
    logger.info(`${TAG} reload from strip: ${currentAppId}`);
    setError(false);
    setLoading(true);
    webViewRef.current?.reload();
  };

  return (
    <View style={styles.body}>
      <PhoneAppBar
        title={displayName}
        tile={
          <AppTile
            name={currentAppId}
            label={currentApp?.displayName}
            logoUrl={currentApp?.logoUrl}
            size={24}
          />
        }
        onBack={handleBack}
        onGrid={handleGrid}
        footer={
          loading ? (
            <ProgressLine />
          ) : error ? (
            <PhoneStatusStrip
              kind="error"
              text={t('phone.pageLoadFailed')}
              onPress={handleReload}
            />
          ) : null
        }
      />
      <RnWebView
        ref={webViewRef}
        source={{ uri }}
        onLoadStart={() => {
          setLoading(true);
          setError(false);
          logger.info(`${TAG} onLoadStart: ${currentAppId}`);
        }}
        onLoadEnd={() => {
          setLoading(false);
          logger.info(`${TAG} onLoadEnd: ${currentAppId}`);
        }}
        onError={() => {
          setLoading(false);
          setError(true);
          logger.error(`${TAG} onError: ${currentAppId}`);
        }}
        style={styles.webview}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  progressTrack: {
    height: 2.5,
    marginHorizontal: 14,
    borderRadius: 2,
    backgroundColor: 'rgba(22,32,46,0.08)',
    overflow: 'hidden',
  },
  progressThumb: {
    height: '100%',
    borderRadius: 2,
  },
});

export default AppSurface;
