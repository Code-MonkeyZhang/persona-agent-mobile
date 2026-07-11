import 'react-native-gesture-handler';
import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import CustomDrawerContent from './history/CustomDrawerContent.tsx';
import { Dimensions, Keyboard, StatusBar } from 'react-native';
import ChatScreen from './chat/ChatScreen.tsx';
import { RouteParamList } from './types/RouteTypes.ts';
import { AppProvider } from './history/AppProvider.tsx';
import SettingsScreen from './settings/SettingsScreen.tsx';
import AgentDetailScreen from './agent-detail/AgentDetailScreen.tsx';
import CompanionScreen from './companion/CompanionScreen.tsx';
import Toast from 'react-native-toast-message';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { isAndroid } from './utils/PlatformUtils.ts';
import { ThemeProvider, useTheme } from './theme/index.ts';
import { configureErrorHandling } from './utils/ErrorUtils.ts';
import TrackPlayer from 'react-native-track-player';
import { ensurePlaybackListener } from './stores/voiceStore';
import { logger } from './lib/logger';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const minWidth = screenWidth > screenHeight ? screenHeight : screenWidth;
const width = minWidth > 434 ? 300 : minWidth * 0.83;

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
  const { colors, isDark } = useTheme();
  return (
    <Drawer.Navigator
      initialRouteName="Bedrock"
      screenOptions={{
        overlayColor: isDark ? 'rgba(255, 255, 255, 0.1)' : undefined,
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
          borderBottomWidth: isDark ? 0.3 : undefined,
          borderBottomColor: isDark ? colors.chatScreenSplit : undefined,
        },
        drawerType: 'slide',
      }}
      drawerContent={renderCustomDrawerContent}
    >
      <Drawer.Screen name="Bedrock" component={ChatScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
    </Drawer.Navigator>
  );
};
/**
 * Stack导航器 - 全屏页面栈管理
 * 包含页面：
 * - Drawer: 抽屉导航器(默认首页)
 * - AgentDetail: Agent 详情页
 * - Companion: Agent 陪伴页面
 */
const AppNavigator = () => {
  const { colors } = useTheme();
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
          headerShown: true,
          title: 'Agent Detail',
          headerTintColor: colors.text,
          headerStyle: { backgroundColor: colors.background },
          headerBackTitle: 'Back',
          animation: 'default',
        }}
      />
      {/* 陪伴页面：隐藏系统导航栏实现全屏沉浸式体验 */}
      <Stack.Screen
        name="Companion"
        component={CompanionScreen}
        options={{ headerShown: false, animation: 'default' }}
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
  const { colors, isDark } = useTheme();
  return (
    <>
      {/* 状态栏：深色模式用浅色文字，浅色模式用深色文字 */}
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
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
    TrackPlayer.setupPlayer()
      .then(() => {
        ensurePlaybackListener();
        logger.info('[App] TrackPlayer setup ok');
      })
      .catch((e) => {
        logger.error('[App] TrackPlayer setup failed:', e);
      });
  }, []);

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
