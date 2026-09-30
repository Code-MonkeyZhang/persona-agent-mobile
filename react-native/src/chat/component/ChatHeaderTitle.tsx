/**
 * @file component/ChatHeaderTitle.tsx
 * @description Chat 头部中间件，会话标题加连接胶囊。
 *   已连接显标题，生成中标题旁跟三个跳动小点。
 *   连接中与重连中出蓝胶囊，断开出红胶囊。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ColorScheme, useTheme, typography } from '../../theme/index.ts';
import { useConnectionStore } from '../../stores/connectionStore.ts';
import { TypingDots } from './TypingDots.tsx';

interface ChatHeaderTitleProps {
  /** 会话标题，热更新补丁优先，进页快照兜底，新建态取新对话文案 */
  title: string;
  /** 会话生成中，标题旁显示运行指示小点 */
  running?: boolean;
}

export function ChatHeaderTitle({ title, running }: ChatHeaderTitleProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const status = useConnectionStore((s) => s.status);
  const styles = createStyles(colors);

  if (status === 'connected') {
    return (
      <View style={styles.root}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {running && <TypingDots />}
      </View>
    );
  }

  const isTransient = status === 'connecting' || status === 'reconnecting';
  const pillColor = isTransient ? colors.primary : colors.error;
  const pillText = isTransient
    ? status === 'connecting'
      ? t('server.connecting')
      : t('connection.reconnecting')
    : t('home.connFailed');

  return (
    <View style={styles.root}>
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <View style={[styles.pill, { backgroundColor: pillColor }]}>
        <Text style={styles.pillText}>{pillText}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    root: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    title: {
      ...typography.titleBar,
      fontWeight: '600',
      color: colors.text,
      maxWidth: 180,
    },
    /** 非连接态出现的连接胶囊 */
    pill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    pillText: {
      ...typography.tertiary,
      fontWeight: '600',
      color: colors.primaryForeground,
    },
  });
