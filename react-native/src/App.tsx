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
import { AppProvider, useAppContext } from './history/AppProvider.tsx';
import SettingsScreen from './settings/SettingsScreen.tsx';
import Toast from 'react-native-toast-message';
import TokenUsageScreen from './settings/TokenUsageScreen.tsx';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PromptScreen from './prompt/PromptScreen.tsx';
import AppGalleryScreen from './app/AppGalleryScreen.tsx';
import AppViewerScreen from './app/AppViewerScreen.tsx';
import CreateAppScreen from './app/CreateAppScreen.tsx';
import ImageGalleryScreen from './image/ImageGalleryScreen.tsx';
import { isAndroid, isMacCatalyst } from './utils/PlatformUtils';
import { ThemeProvider, useTheme } from './theme';
import { configureErrorHandling } from './utils/ErrorUtils';
import { migrateOpenAICompatConfig } from './storage/StorageUtils.ts';

// Mac桌面端的UI计算, 如果要去除桌面端的能力可以删掉 TODO:

export const isMac = isMacCatalyst;
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const minWidth = screenWidth > screenHeight ? screenHeight : screenWidth;
const width = minWidth > 434 ? 300 : minWidth * 0.83;

// 创建Drawer导航器实例，RouteParamList提供类型安全的路由参数
const Drawer = createDrawerNavigator<RouteParamList>();

// 创建Stack导航器实例，用于全屏页面之间的跳转
const Stack = createNativeStackNavigator();

// 渲染自定义抽屉内容的包装器
// CustomDrawerContent 定义了侧边栏的布局：快捷入口(Chat/Image/App) + 聊天历史列表 + Settings
// 将props透传给CustomDrawerContent组件
const renderCustomDrawerContent = (
  props: React.JSX.IntrinsicAttributes & DrawerContentComponentProps
) => <CustomDrawerContent {...props} />;

/**
 * 抽屉导航器 - 侧边滑出的导航菜单
 *
 * 它管理的是主内容区（右侧）显示哪个页面：
 * ┌──────────────┬──────────────────────┐
 * │ 侧边栏内容    │  主内容区域            │
 * │ (CustomDrawer │  (Drawer.Screen)     │
 * │  Content)    │                      │
 * │              │                      │
 * │ Chat/Image/  │  ← 当前显示的页面      │
 * │ App入口      │  (Bedrock/Settings/   │
 * │ Session列表   │   ImageGallery等)     │
 * │ ...          │                      │
 * │ Settings入口  │                      │
 * └──────────────┴──────────────────────┘
 *
 * - drawerContent: 使用自定义的CustomDrawerContent渲染侧边栏内容
 * - drawerType: Mac端支持permanent(常驻)/slide(滑出)模式切换，其他平台固定用slide
 */
const DrawerNavigator = () => {
  const { drawerType } = useAppContext();
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
          borderRightWidth: isMac ? 1 : isAndroid ? 0.3 : 0,
          borderRightColor: colors.border,
        },
        headerStyle: {
          height: isMac ? 66 : undefined,
          backgroundColor: colors.background,
          borderBottomWidth: isDark ? 0.3 : undefined,
          borderBottomColor: isDark ? colors.chatScreenSplit : undefined,
        },
        drawerType: isMac ? drawerType : 'slide',
      }}
      drawerContent={renderCustomDrawerContent}>
      <Drawer.Screen name="Bedrock" component={ChatScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
      <Drawer.Screen name="ImageGallery" component={ImageGalleryScreen} />
      <Drawer.Screen name="AppGallery" component={AppGalleryScreen} />
    </Drawer.Navigator>
  );
};
/**
 * Stack导航器 - 全屏页面栈管理
 * 包含6个页面：
 * - Drawer: 抽屉导航器(默认首页)
 * - TokenUsage: Token使用统计
 * - Prompt: 系统提示词配置
 * - AppViewer: 应用查看器
 * - CreateApp: 创建应用
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
        name="TokenUsage"
        component={TokenUsageScreen}
        options={{
          title: 'Usage',
          contentStyle: {
            height: isMac ? 66 : undefined,
            backgroundColor: colors.background,
          },
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <Stack.Screen
        name="Prompt"
        component={PromptScreen}
        options={{
          title: 'System Prompt',
          contentStyle: {
            height: isMac ? 66 : undefined,
            backgroundColor: colors.background,
          },
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <Stack.Screen
        name="AppViewer"
        component={AppViewerScreen}
        options={({ route }) => {
          const params = route.params as RouteParamList['AppViewer'];
          return {
            title: params?.app?.name ?? 'App',
            contentStyle: {
              height: isMac ? 66 : undefined,
              backgroundColor: '#000000',
            },
            headerTitleAlign: 'center',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          };
        }}
      />
      <Stack.Screen
        name="CreateApp"
        component={CreateAppScreen}
        options={{
          title: 'Create App',
          contentStyle: {
            height: isMac ? 66 : undefined,
            backgroundColor: colors.background,
          },
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
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
        onStateChange={_ => {
          Keyboard.dismiss();
        }}>
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
    configureErrorHandling();
    migrateOpenAICompatConfig();
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
