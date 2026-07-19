import { NavigatorScreenParams } from '@react-navigation/native';

/**
 * DrawerParamList - 侧边栏导航器的页面参数表
 *   Bedrock（聊天页）：会话切换已改由 sessionStore.activeSessionId 驱动，无需路由参数
 */
export type DrawerParamList = {
  Bedrock: undefined;
};

/**
 * RouteParamList - 整个应用根导航器的页面参数表
 */
export type RouteParamList = {
  Drawer: NavigatorScreenParams<DrawerParamList>;
  Bedrock: undefined;
  Settings: NonNullable<unknown>;
  AgentDetail: { agentId: string };
  Server: undefined;
  ScanQR: undefined;
};
