/**
 * @file AppSurface.tsx
 * @description Agent App 全屏 WebView 页面。Stack screen。
 *   header：默认返回箭头（回聊天，保留 currentAppId）| 图标+名称居中 | ▦ 回网格。
 *   关即卸载 WebView，重开重载（无状态约定）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WebView, type WebViewProps } from 'react-native-webview';
import { LayoutGrid } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/index.ts';
import { useAppPanelStore } from '../../stores/appPanelStore';
import { getServerAddress } from '../../storage/StorageUtils.ts';
import { logger } from '../../lib/logger';
import AppIcon from './AppIcon.tsx';
import LoadingSpinner from './LoadingSpinner.tsx';
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

const AppSurface: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<AppSurfaceNav>();
  const currentAppId = useAppPanelStore((s) => s.currentAppId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const webViewRef = useRef<WebViewHandle>(null);

  const serverAddress = getServerAddress();

  useEffect(() => {
    logger.info(`${TAG} mount: ${currentAppId}`);
  }, [currentAppId]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerTitle: () =>
        currentAppId ? (
          <View style={styles.headerCenter}>
            <AppIcon
              name={currentAppId}
              serverAddress={serverAddress}
              size={28}
            />
            <Text
              style={[styles.appName, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {currentAppId}
            </Text>
          </View>
        ) : null,
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.replace('AppLauncher')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <LayoutGrid size={22} color={colors.text} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, currentAppId, colors.text, serverAddress]);

  if (!currentAppId) {
    return null;
  }

  const uri = `${serverAddress}/apps/${currentAppId}/mobile`;

  return (
    <View style={styles.body}>
      <RnWebView
        ref={webViewRef}
        source={{ uri }}
        onLoadStart={() => {
          setLoading(true);
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
      {loading && (
        <View style={styles.overlay}>
          <LoadingSpinner visible size={32} />
        </View>
      )}
      {error && (
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => {
            setError(false);
            setLoading(true);
            webViewRef.current?.reload();
          }}
        >
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {t('appPanel.error')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  headerCenter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  appName: {
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 10,
  },
  webview: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 15,
  },
});

export default AppSurface;
