import { Platform } from 'react-native';

/** 单档字体 token 的形状，字号与配对行高成对出现 */
interface TypographyTier {
  fontSize: number;
  lineHeight: number;
}

/** 语义层十三档，档位与配对行高取自设计规范的移动端字体规范数值层，使用处整体散布进 TextStyle */
export const typography = {
  micro: { fontSize: 10, lineHeight: 14 },
  tertiary: { fontSize: 11, lineHeight: 15 },
  caption: { fontSize: 12, lineHeight: 16 },
  desc: { fontSize: 12.5, lineHeight: 17 },
  meta: { fontSize: 13, lineHeight: 18 },
  content: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 15, lineHeight: 21 },
  bodyLg: { fontSize: 16, lineHeight: 22 },
  titleBar: { fontSize: 17, lineHeight: 22 },
  titleSection: { fontSize: 18, lineHeight: 24 },
  titlePage: { fontSize: 19, lineHeight: 24 },
  titleDisplay: { fontSize: 20, lineHeight: 26 },
  display: { fontSize: 30, lineHeight: 36 },
} satisfies Record<string, TypographyTier>;

/** 十三档整体类型，ThemeContext 暴露与各处解构使用 */
export type Typography = typeof typography;

/** 等宽字体，代码与功能名的展示档，iOS 统一 Menlo */
export const monoFont = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});
