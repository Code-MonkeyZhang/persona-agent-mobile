import React, {
  memo,
  useCallback,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FlatList } from 'react-native';
import { MarkdownProps } from 'react-native-marked';
import useMarkdown from './useMarkdown.ts';
import { ChatStatus } from '../../../types/Chat.ts';
import { useTheme } from '../../../theme';

type ChatMarkdownProps = MarkdownProps & {
  chatStatus: ChatStatus;
};

const Markdown = ({
  value,
  flatListProps,
  theme,
  baseUrl,
  renderer,
  styles,
  tokenizer,
  chatStatus,
}: ChatMarkdownProps) => {
  const { colors } = useTheme();
  const rnElements = useMarkdown(value, {
    theme,
    baseUrl,
    renderer,
    styles,
    tokenizer,
    chatStatus,
  });

  const renderItem = useCallback(({ item }: { item: ReactNode }) => {
    return item as ReactElement;
  }, []);

  const keyExtractor = useCallback(
    (_: ReactNode, index: number) => index.toString(),
    []
  );

  return (
    <FlatList
      removeClippedSubviews={false}
      keyExtractor={keyExtractor}
      initialNumToRender={rnElements.length}
      style={{
        backgroundColor: colors.background,
      }}
      {...flatListProps}
      data={rnElements}
      renderItem={renderItem}
    />
  );
};

export default memo(Markdown);
