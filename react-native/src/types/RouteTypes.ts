/**
 * RouteParamList - 整个应用根导航器的页面参数表
 *   Chat 的 title 是进入时列表标题的快照，标题热更新走 sessionStore.sessionTitles
 *   AgentNav 的 view 决定工具或技能视图，McpDetail 与 SkillDetail 的 name 是条目机器名
 */
export type RouteParamList = {
  Home: undefined;
  Chat: { title?: string } | undefined;
  Settings: undefined;
  AgentDetail: { agentId: string };
  AgentNav: { view: 'tools' | 'skills' };
  McpDetail: { name: string };
  SkillDetail: { name: string };
  BuiltinDetail: { id: string };
  Server: undefined;
  ScanQR: undefined;
  AppLauncher: undefined;
  AppSurface: undefined;
};
