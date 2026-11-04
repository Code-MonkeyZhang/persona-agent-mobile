/**
 * @file component/markdown/Markdown.tsx
 * @description Markdown 主渲染入口，解析产物铺进普通视图同步布局。
 *   气泡内的内容量不需要虚拟化，嵌套 FlatList 的异步测高会让行容器高度
 *   与内容脱节导致气泡堆叠，普通视图在挂载当帧完成布局。
 */
import React, { memo, useMemo } from 'react';
import { View } from 'react-native';
import type { Tokenizer } from 'marked';
import type {
  MarkedStyles,
  UserTheme,
} from 'react-native-marked/src/theme/types';
import type { RendererInterface } from 'react-native-marked/src/lib/types';
import useMarkdown from './useMarkdown.ts';

interface ChatMarkdownProps {
  value: string;
  theme?: UserTheme;
  baseUrl?: string;
  renderer?: RendererInterface;
  styles?: MarkedStyles;
  tokenizer?: Tokenizer;
}

const Markdown = ({
  value,
  theme,
  baseUrl,
  renderer,
  styles,
  tokenizer,
}: ChatMarkdownProps) => {
  const parseOptions = useMemo(
    () => ({ theme, baseUrl, renderer, styles, tokenizer }),
    [theme, baseUrl, renderer, styles, tokenizer]
  );

  const rnElements = useMarkdown(value, parseOptions);

  return (
    <View>
      {rnElements.map((element, index) => (
        <React.Fragment key={index}>{element}</React.Fragment>
      ))}
    </View>
  );
};

export default memo(Markdown);
