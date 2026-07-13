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
import ServerScreen from './server/ServerScreen.tsx';
import ToolsScreen from './tools/ToolsScreen.tsx';
import SkillsScreen from './skills/SkillsScreen.tsx';
import Toast from 'react-native-toast-message';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { isAndroid } from './utils/PlatformUtils.ts';
import { ThemeProvider, useTheme } from './theme/index.ts';
import { configureErrorHandling } from './utils/ErrorUtils.ts';
import TrackPlayer from 'react-native-track-player';
import { ensurePlaybackListener } from './stores/voiceStore';
import { getAudioPlayer } from './lib/audio-player';
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
 * - Server: 服务器/隧道连接页（占位，步骤 09 填充）
 * - Tools: 工具管理页（占位，步骤 09 填充）
 * - Skills: 技能展示页（占位，步骤 09 填充）
 * - Settings: 设置页
 *
 * 从侧边栏入口进入的页面统一使用 slide_from_bottom 动画，
 * 返回时侧边栏保持开启状态。
 */
const AppNavigator = () => {
  const { colors } = useTheme();
  const stackScreenOptions = {
    headerShown: true,
    headerTintColor: colors.text,
    headerStyle: { backgroundColor: colors.background },
    headerBackTitle: 'Back',
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
          title: 'Agent Detail',
        }}
      />
      <Stack.Screen
        name="Server"
        component={ServerScreen}
        options={{ ...stackScreenOptions, title: 'Server' }}
      />
      <Stack.Screen
        name="Tools"
        component={ToolsScreen}
        options={{ ...stackScreenOptions, title: 'Tools' }}
      />
      <Stack.Screen
        name="Skills"
        component={SkillsScreen}
        options={{ ...stackScreenOptions, title: 'Skills' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ ...stackScreenOptions, title: 'Settings' }}
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
