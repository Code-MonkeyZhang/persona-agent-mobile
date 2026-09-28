/**
 * RouteParamList - 整个应用根导航器的页面参数表
 *   Chat 的 title 是进入时列表标题的快照，标题热更新走 sessionStore.sessionTitles
 */
export type RouteParamList = {
  Home: undefined;
  Chat: { title?: string } | undefined;
  Settings: undefined;
  AgentDetail: { agentId: string };
  Server: undefined;
  ScanQR: undefined;
  AppLauncher: undefined;
  AppSurface: undefined;
};
