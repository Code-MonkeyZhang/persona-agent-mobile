/**
 * @file component/IconHeaderTitle.tsx
 * @description Stack header 通用标题，图标加文字的横向组合。
 *   记忆、工具与技能三页共用，图标与首页入口行同源，
 *   图标颜色跟标题文字同色，读成一个标题单元。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { ColorScheme, useTheme, typography } from '../theme/index.ts';

interface IconHeaderTitleProps {
  /** 标题左侧的图标，与页面入口行同源 */
  icon: LucideIcon;
  /** 标题文字，随页面视图取值 */
  title: string;
}

export function IconHeaderTitle({ icon: Icon, title }: IconHeaderTitleProps) {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.root}>
      <Icon size={18} color={colors.text} />
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
      gap: 6,
    },
    title: {
      ...typography.titleBar,
      fontWeight: '600',
      color: colors.text,
    },
  });
