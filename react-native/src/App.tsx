import 'react-native-gesture-handler';
import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import CustomDrawerContent from './history/CustomDrawerContent.tsx';
import { Dimensions, Keyboard, StatusBar, AppState } from 'react-native';
import ChatScreen from './chat/ChatScreen.tsx';
import { RouteParamList } from './types/RouteTypes.ts';
import { AppProvider } from './history/AppProvider.tsx';
import SettingsScreen from './settings/SettingsScreen.tsx';
import AgentDetailScreen from './agent-detail/AgentDetailScreen.tsx';
import ServerScreen from './server/ServerScreen.tsx';
import ScanQRScreen from './server/ScanQRScreen.tsx';
import Toast from 'react-native-toast-message';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { isAndroid } from './utils/PlatformUtils.ts';
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

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const minWidth = screenWidth > screenHeight ? screenHeight : screenWidth;
const width = minWidth > 434 ? 300 : minWidth * 0.83;

/**
 * 抽屉 pan 手势的激活阈值（px）。
 * 调高到 20，让会话列表项的 Swipeable（默认 10px 激活）在项上先激活、取消抽屉手势，
 * 从而避免“左滑删除”被抽屉的“左滑收起”抢走；在非会话项区域左滑仍可收起抽屉。
 * 觉得抽屉开合太钝/太灵时，只调这一个数字即可。
 */
const DRAWER_SWIPE_ACTIVATION = 20;

// 创建Drawer导航器实例，RouteParamList提供类型安全的路由参数
const Drawer = createDrawerNavigator<RouteParamList>();

// 创建Stack导航器实例，用于全屏页面之间的跳转
const Stack = createNativeStackNavigator<RouteParamList>();

// 渲染自定义抽屉内容的包装器
// CustomDrawerContent 定义了侧边栏的布局：快捷入口(Chat/Image) + 聊天历史列表 + Settings
// 将props透传给CustomDrawerContent组件
const renderCustomDrawerContent = (
  props: React.JSX.IntrinsicAttributes & DrawerContentComponentProps
) => <CustomDrawerContent {...props} />;

/**
 * 抽屉导航器 - 侧边滑出的导航菜单
 * - drawerContent: 使用自定义的CustomDrawerContent渲染侧边栏内容
 */
const DrawerNavigator = () => {
  const { colors } = useTheme();
  return (
    <Drawer.Navigator
      initialRouteName="Bedrock"
      screenOptions={{
        headerTintColor: colors.text,
        headerTitleAlign: 'center',
        drawerStyle: {
          width: width,
          backgroundColor: colors.background,
          borderRightWidth: isAndroid ? 0.3 : 0,
          borderRightColor: colors.border,
        },
        headerStyle: {
          backgroundColor: colors.background,
        },
        drawerType: 'slide',
        // 提高抽屉滑动手势的激活阈值，让会话项的左滑删除优先于抽屉的左滑收起
        configureGestureHandler: (gesture) =>
          gesture.activeOffsetX([
            -DRAWER_SWIPE_ACTIVATION,
            DRAWER_SWIPE_ACTIVATION,
          ]),
      }}
      drawerContent={renderCustomDrawerContent}
    >
      <Drawer.Screen name="Bedrock" component={ChatScreen} />
    </Drawer.Navigator>
  );
};
/**
 * Stack导航器 - 全屏页面栈管理
 * 包含页面：
 * - Drawer: 抽屉导航器(默认首页)
 * - AgentDetail: Agent 详情页
 * - Server: 服务器/隧道连接页
 * - Settings: 设置页
 *
 * 从侧边栏入口进入的页面统一使用 slide_from_bottom 动画，
 * 返回时侧边栏保持开启状态。
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
    <Stack.Navigator initialRouteName="Drawer" screenOptions={{}}>
      <Stack.Screen
        name="Drawer"
        component={DrawerNavigator}
        options={{ headerShown: false, headerLargeTitleShadowVisible: false }}
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
        options={{ ...stackScreenOptions, title: t('drawer.server') }}
      />
      <Stack.Screen
        name="ScanQR"
        component={ScanQRScreen}
        options={{ ...stackScreenOptions, title: t('server.scanToConnect') }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ ...stackScreenOptions, title: t('drawer.settings') }}
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
      {/* 导航容器：管理页面跳转，页面切换时自动收起键盘 */}
      <NavigationContainer
        onStateChange={(_) => {
          Keyboard.dismiss();
        }}
      >
        <AppNavigator />
      </NavigationContainer>
    </>
  );
};

/**
 * 应用根组件
 */
const App = () => {
  React.useEffect(() => {
    logger.info('[App] root mounted, initializing');
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

    /** 监听 app 回前台：重试连接并检测系统语言变更 */
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
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  /** 地址失效时弹出 toast 提醒用户重新连接 */
  const connStatus = useConnectionStore((s) => s.status);
  const prevStatusRef = React.useRef(connStatus);
  React.useEffect(() => {
    if (
      connStatus === 'address_invalid' &&
      prevStatusRef.current !== 'address_invalid'
    ) {
      Toast.show({
        type: 'error',
        text1: i18n.t('connection.addressInvalid'),
        position: 'top',
        visibilityTime: 5000,
      });
    }
    prevStatusRef.current = connStatus;
  }, [connStatus]);

  return (
    <>
      <ThemeProvider>
        <AppProvider>
          <AppWithTheme />
        </AppProvider>
      </ThemeProvider>
      <Toast />
    </>
  );
};

export default App;
