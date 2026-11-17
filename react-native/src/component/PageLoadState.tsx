/**
 * @file component/PageLoadState.tsx
 * @description 页面级数据三态的统一展示件。
 *   loading 居中转圈，error 居中失败文案，ready 渲染正文。
 *   记忆页与工具技能导航页共用，替代各自为政的弹窗、空白与私有转圈。
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ColorScheme, useTheme, typography } from '../theme/index.ts';

/** 页面数据态的三档，互斥 */
export type PagePhase = 'loading' | 'error' | 'ready';

export function PageLoadState({
  phase,
  children,
}: {
  phase: PagePhase;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  if (phase === 'loading') {
    return (
      <View style={styles.fill}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.fill}>
        <Text style={styles.errorText}>{t('nav.loadFailed')}</Text>
      </View>
    );
  }

  return <>{children}</>;
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    fill: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
    },
    errorText: {
      ...typography.body,
      color: colors.textTertiary,
    },
  });
