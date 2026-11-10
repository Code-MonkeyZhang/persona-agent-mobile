/**
 * RouteParamList - 整个应用根导航器的页面参数表
 *   Chat 的 title 是进入时列表标题的快照，标题热更新走 sessionStore.sessionTitles
 *   AgentNav 的 view 决定工具或技能视图，McpDetail 与 BuiltinDetail 的 id 是注册表条目 id，
 *   SkillDetail 的 name 是技能机器名，MemoryScreen 的 agentId 决定记忆归属，从详情页与首页入口都能进
 */
export type RouteParamList = {
  Home: undefined;
  Chat: { title?: string } | undefined;
  Settings: undefined;
  About: undefined;
  AgentDetail: { agentId: string };
  AgentNav: { view: 'tools' | 'skills' };
  McpDetail: { id: string };
  SkillDetail: { name: string };
  BuiltinDetail: { id: string };
  MemoryScreen: { agentId: string };
  ScanQR: undefined;
  DeviceManage: undefined;
  DeviceDetail: { hostId: string };
  AppLauncher: undefined;
  AppSurface: undefined;
};
