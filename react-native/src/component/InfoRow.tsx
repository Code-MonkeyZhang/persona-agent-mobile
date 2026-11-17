/**
 * @file InfoRow.tsx
 * @description 通用只读信息行,设备详情与关于页共用。
 *   标签在左值右对齐超长省略,技术标识走等宽字形,divided 控制组内顶部分隔线。
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ColorScheme, monoFont, typography, useTheme } from '../theme/index.ts';

interface InfoRowProps {
  label: string;
  value: string;
  /** 技术标识走等宽字形 */
  mono?: boolean;
  /** 组内非首行画顶部分隔线 */
  divided?: boolean;
}

/** 只读信息行,标签在左,值右对齐超长省略 */
export function InfoRow({ label, value, mono, divided }: InfoRowProps) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={[styles.row, divided && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={mono ? styles.rowValueMono : styles.rowValue}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
      minHeight: 50,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    rowLabel: {
      ...typography.content,
      color: colors.text,
    },
    rowValue: {
      flex: 1,
      ...typography.content,
      color: colors.textSecondary,
      textAlign: 'right',
    },
    rowValueMono: {
      flex: 1,
      fontSize: 12.5,
      fontFamily: monoFont,
      color: colors.textSecondary,
      textAlign: 'right',
    },
  });
