import { ChatMode, SystemPrompt } from './Chat.ts';
import { NavigatorScreenParams } from '@react-navigation/native';

/**
 * DrawerParamList - 侧边栏导航器的页面参数表
 * 管理侧边栏内部的页面跳转数据：
 *   Bedrock（聊天页）: 可传 sessionId（会话ID）、tapIndex（消息定位）、mode（聊天模式）
 *   Settings（设置页）: 不需要传参数
 */
export type DrawerParamList = {
  Bedrock: {
    sessionId?: number;
    tapIndex?: number;
    mode?: ChatMode;
  };
  Settings: NonNullable<unknown>;
};

/**
 * RouteParamList - 整个应用根导航器的页面参数表
 * 管理应用所有页面的跳转数据，范围比 DrawerParamList 更大：
 *   包含侧边栏（Drawer）、聊天页、设置页、Token用量页、提示词编辑页、
 *   App列表页、App详情页、创建App页、图片列表页
 * 每个页面声明了自己跳转时需要接收哪些数据，TypeScript 会在编译时检查传参是否正确
 */
export type RouteParamList = {
  Drawer: NavigatorScreenParams<DrawerParamList>;
  Bedrock: {
    sessionId?: number;
    tapIndex?: number;
    mode?: ChatMode;
  };
  Settings: NonNullable<unknown>;
  TokenUsage: NonNullable<unknown>;
  Prompt: {
    prompt?: SystemPrompt;
    promptType?: string | undefined;
  };
  ImageGallery: NonNullable<unknown>;
};
