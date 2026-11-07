/**
 * @file component/markdown/useMarkdown.ts
 * @description 正文到 React 元素的解析钩子，解析产物进模块级缓存。
 *   缓存键为正文字符串，行回收重挂载直接命中缓存不再全文重解析。
 *   当前样式输入只有一套浅色配色，深色主题落地时需把配色对象纳入缓存键。
 *   移动端正文明细为步末整段落行，不存在逐字流式追加，直接全文解析。
 */
import { type ReactNode, useMemo } from 'react';
import { lexer, type Tokenizer } from 'marked';
import type {
  MarkedStyles,
  UserTheme,
} from 'react-native-marked/src/theme/types';
import Renderer from 'react-native-marked/src/lib/Renderer';
import getStyles from 'react-native-marked/src/theme/styles';
import type { RendererInterface } from 'react-native-marked/src/lib/types';
import Parser from './Parser.tsx';

export interface useMarkdownHookOptions {
  renderer?: RendererInterface;
  theme?: UserTheme;
  styles?: MarkedStyles;
  baseUrl?: string;
  tokenizer?: Tokenizer;
}

/** 缓存条目上限，超出后按插入序淘汰最旧一条，长会话滚动时缓存占用有界 */
const CACHE_LIMIT = 300;

/** 模块级解析缓存，行回收重挂载跨实例共享，键为正文字符串 */
const elementCache = new Map<string, ReactNode[]>();

/** 读缓存，未命中时全文解析入库并按上限淘汰 */
function parseWithCache(
  value: string,
  options?: useMarkdownHookOptions
): ReactNode[] {
  const cached = elementCache.get(value);
  if (cached) {
    return cached;
  }
  const tokens = lexer(value, {
    gfm: true,
    tokenizer: options?.tokenizer,
  });
  const styles = getStyles(options?.styles, 'light', options?.theme);
  const parser = new Parser({
    styles,
    baseUrl: options?.baseUrl,
    renderer: options?.renderer ?? new Renderer(),
  });
  const elements = parser.parse(tokens);
  if (elementCache.size >= CACHE_LIMIT) {
    const oldest = elementCache.keys().next().value;
    if (oldest !== undefined) {
      elementCache.delete(oldest);
    }
  }
  elementCache.set(value, elements);
  return elements;
}

const useMarkdown = (
  value: string,
  options?: useMarkdownHookOptions
): ReactNode[] => {
  return useMemo(
    () => (value ? parseWithCache(value, options) : []),
    [value, options]
  );
};

export default useMarkdown;
