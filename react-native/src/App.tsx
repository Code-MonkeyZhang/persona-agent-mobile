import 'react-native-gesture-handler';
import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { Keyboard, StatusBar, AppState, StyleSheet } from 'react-native';
import ChatScreen from './chat/ChatScreen.tsx';
import HomeScreen from './home/HomeScreen.tsx';
import { RouteParamList } from './types/RouteTypes.ts';
import SettingsScreen from './settings/SettingsScreen.tsx';
import AgentDetailScreen from './agent-detail/AgentDetailScreen.tsx';
import ServerScreen from './server/ServerScreen.tsx';
import ScanQRScreen from './server/ScanQRScreen.tsx';
import AppLauncher from './chat/component/AppLauncher.tsx';
import AppSurface from './chat/component/AppSurface.tsx';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { refreshDeviceName } from './utils/DeviceUtils.ts';
import { useConnectionStore } from './stores/connectionStore.ts';
import { ThemeProvider, useTheme } from './theme/index.ts';
import { configureErrorHandling } from './utils/ErrorUtils.ts';
import TrackPlayer from 'react-native-track-player';
import { ensurePlaybackListener } from './stores/voiceStore';
import { getAudioPlayer } from './lib/audio-player';
import { logger } from './lib/logger';
import './i18n/index.ts';
import i18n, { detectLanguage } from './i18n/index.ts';

// 创建Stack导航器实例，用于全屏页面之间的跳转
const Stack = createNativeStackNavigator<RouteParamList>();

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

/**
 * Stack导航器 - 全屏页面栈管理
 * 包含页面：
 * - Home: 会话主页(默认首屏)
 * - Chat: 聊天页(压栈进入，返回即卸载，头部由 ChatScreen 自配置)
 * - AgentDetail / Server / ScanQR / Settings / AppLauncher / AppSurface
 */
const AppNavigator = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const stackScreenOptions = {
    headerShown: true,
    headerTintColor: colors.text,
    headerStyle: { backgroundColor: colors.background },
    headerBackTitle: t('common.back'),
    animation: 'default' as const,
  };
  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={{}}>
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false, headerLargeTitleShadowVisible: false }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={stackScreenOptions}
      />
      <Stack.Screen
        name="AgentDetail"
        component={AgentDetailScreen}
        options={{
          ...stackScreenOptions,
          title: t('agent.title'),
        }}
      />
      <Stack.Screen
        name="Server"
        component={ServerScreen}
        options={{ ...stackScreenOptions, title: t('home.server') }}
      />
      <Stack.Screen
        name="ScanQR"
        component={ScanQRScreen}
        options={{ ...stackScreenOptions, title: t('server.scanToConnect') }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ ...stackScreenOptions, title: t('home.settings') }}
      />
      {/* Agent App 工作区：网格与全屏 App 之间 replace 互跳，不堆叠 */}
      <Stack.Screen
        name="AppLauncher"
        component={AppLauncher}
        options={{ ...stackScreenOptions, title: t('appPanel.title') }}
      />
      <Stack.Screen
        name="AppSurface"
        component={AppSurface}
        options={{ ...stackScreenOptions, title: '' }}
      />
    </Stack.Navigator>
  );
};

/**
 * 带主题的导航容器
 * - StatusBar: 显示时间/信号/电量的顶部状态栏，根据深色/浅色模式切换文字颜色
 * - NavigationContainer: 管理所有页面的跳转和状态，包裹导航器使其具备页面跳转能力
 *   - onStateChange: 导航状态变化时触发的回调，以下操作都会触发：
 *     1. 页面跳转（如从聊天页跳转到设置页）
 *     2. 页面返回（点击返回按钮或调用goBack）
 *     3. 抽屉打开/关闭
 *     4. Tab切换
 *   - 此处用于每次切换页面时自动收起键盘，防止键盘遮挡其他页面内容
 */
const AppWithTheme = () => {
  const { colors } = useTheme();
  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      {/* 手势根视图：左滑删除等 RNGH 手势组件依赖此包装，原抽屉导航器自带的隐式包装已随抽屉移除 */}
      <GestureHandlerRootView style={styles.flex}>
        {/* 导航容器：管理页面跳转，页面切换时自动收起键盘 */}
        <NavigationContainer
          onStateChange={(_) => {
            Keyboard.dismiss();
          }}
        >
          <AppNavigator />
        </NavigationContainer>
      </GestureHandlerRootView>
    </>
  );
};

/**
 * 应用根组件
 */
const App = () => {
  React.useEffect(() => {
    logger.info('[App] root mounted, initializing');
    logger.init();
    configureErrorHandling();
    logger.debug('[App] error handling configured');
    const setupPromise = TrackPlayer.setupPlayer();
    getAudioPlayer().init(setupPromise);
    setupPromise
      .then(() => {
        ensurePlaybackListener();
        logger.info('[App] TrackPlayer setup ok');
      })
      .catch((e) => {
        logger.error('[App] TrackPlayer setup failed:', e);
      });

    /** 刷新设备名缓存并启动冷连接 */
    refreshDeviceName();
    useConnectionStore.getState().coldStart();

    /**
     * 监听 app 前后台切换：
     * - 回前台：检测系统语言变更 + 若未连上则重试连接
     * - 进后台：立即 flush 日志缓冲，防止 JS 冻结丢日志
     */
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        const lang = detectLanguage();
        if (i18n.language !== lang) {
          logger.info(`[App] app resumed, language changed to: ${lang}`);
          i18n.changeLanguage(lang);
        }
        const conn = useConnectionStore.getState();
        if (conn.status !== 'connected' && conn.serverAddress) {
          logger.info('[App] app resumed, retrying connection');
          conn.coldStart();
        }
      } else if (nextState === 'background' || nextState === 'inactive') {
        logger.info('[App] app backgrounded, flushing logs');
        logger.flush();
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <ThemeProvider>
      <AppWithTheme />
    </ThemeProvider>
  );
};

export default App;
