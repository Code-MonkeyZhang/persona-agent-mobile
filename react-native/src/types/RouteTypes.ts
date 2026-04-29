import { NavigatorScreenParams } from '@react-navigation/native';

/**
 * DrawerParamList - 侧边栏导航器的页面参数表
 * 管理侧边栏内部的页面跳转数据：
 *   Bedrock（聊天页）: 可传 sessionId（服务器 UUID）、tapIndex（消息定位）
 *   Settings（设置页）: 不需要传参数
 */
export type DrawerParamList = {
  Bedrock: {
    sessionId?: string;
    tapIndex?: number;
  };
  Settings: NonNullable<unknown>;
};

/**
 * RouteParamList - 整个应用根导航器的页面参数表
 */
export type RouteParamList = {
  Drawer: NavigatorScreenParams<DrawerParamList>;
  Bedrock: {
    sessionId?: string;
    tapIndex?: number;
  };
  Settings: NonNullable<unknown>;
  AgentDetail: { agentId: string };
  Companion: { agentId: string; sessionId?: string };
};
