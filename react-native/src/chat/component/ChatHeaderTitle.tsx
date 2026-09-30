/**
 * @file component/ChatHeaderTitle.tsx
 * @description Chat 头部中间件，常驻居中的会话标题。
 *   连接态显示已移交 ChatScreen 的 ConnectionBanner，生成指示已移交 SweepIndicator。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ColorScheme, useTheme, typography } from '../../theme/index.ts';

interface ChatHeaderTitleProps {
  /** 会话标题，热更新补丁优先，进页快照兜底，新建态取新对话文案 */
  title: string;
}

export function ChatHeaderTitle({ title }: ChatHeaderTitleProps) {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.root}>
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    root: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      ...typography.titleBar,
      fontWeight: '600',
      color: colors.text,
      maxWidth: 180,
    },
  });
