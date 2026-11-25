/**
 * 颜色 token 定义，所有组件应通过 useTheme() 引用此处的值，不得硬编码颜色。
 */

export interface ColorScheme {
  // 表面与背景
  background: string;
  surface: string;
  surfaceSecondary: string;
  card: string;
  codeBackground: string;
  selectedBackground: string;
  messageBackground: string;
  labelBackground: string;
  fileListBackground: string;
  // 输入相关
  input: string;
  inputBackground: string;
  inputBorder: string;
  // 文字
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDarkGray: string;
  placeholder: string;
  primaryForeground: string;
  // 线条与阴影
  border: string;
  borderLight: string;
  shadow: string;
  // 遮罩
  overlay: string;
  overlayLight: string;
  // 品牌与状态
  primary: string;
  primarySelectedBackground: string;
  /** 主色的更浅一档，模型弹层选中行的整行底色 */
  primaryFaintBackground: string;
  primaryBorder: string;
  primaryDisabled: string;
  error: string;
  errorBackground: string;
  success: string;
  successBackground: string;
  warning: string;
  warningBackground: string;
  info: string;
  // 文件列表
  fileItemBorder: string;
  // 徽章
  /** 容量徽章的描边色，与上下文占用小壳的描边同色 */
  badgeBorder: string;
}

export const lightColors: ColorScheme = {
  background: '#ffffff',
  surface: '#f5f5f5',
  surfaceSecondary: '#f9f9f9',
  card: '#ffffff',
  codeBackground: '#F8F8F8',
  selectedBackground: '#F5F5F5',
  messageBackground: '#f2f2f2',
  labelBackground: '#ffffff',
  fileListBackground: '#ffffff',

  input: '#f8f8f8',
  inputBackground: '#ffffff',
  inputBorder: '#808080',

  text: '#000000',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textDarkGray: '#333333',
  placeholder: '#999999',
  primaryForeground: '#ffffff',

  border: '#e0e0e0',
  borderLight: '#eaeaea',
  shadow: 'rgba(0,0,0,0.1)',

  overlay: 'rgba(0,0,0,0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.1)',

  primary: '#007AFF',
  primarySelectedBackground: 'rgba(0, 122, 255, 0.1)',
  primaryFaintBackground: 'rgba(0, 122, 255, 0.06)',
  primaryBorder: 'rgba(0, 122, 255, 0.25)',
  primaryDisabled: 'rgba(0, 122, 255, 0.4)',
  error: '#ff4444',
  errorBackground: 'rgba(255, 68, 68, 0.1)',
  success: '#00C851',
  successBackground: 'rgba(0, 200, 81, 0.1)',
  warning: '#ffbb33',
  warningBackground: 'rgba(245,158,11,0.15)',
  info: '#33b5e5',

  fileItemBorder: '#e0e0e0',
  badgeBorder: '#e3e3e6',
};
