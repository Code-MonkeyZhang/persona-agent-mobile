import { NavigatorScreenParams } from '@react-navigation/native';

/**
 * DrawerParamList - 侧边栏导航器的页面参数表
 *   Bedrock（聊天页）: 可传 sessionId（服务器 UUID）、tapIndex（消息定位）
 */
export type DrawerParamList = {
  Bedrock: {
    sessionId?: string;
    tapIndex?: number;
  };
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
  Server: NonNullable<unknown>;
  Tools: NonNullable<unknown>;
  Skills: NonNullable<unknown>;
};
