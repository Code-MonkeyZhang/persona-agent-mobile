/**
 * @file PhoneStatusStrip.tsx
 * @description 小手机状态条。行高内边距与配色对齐 ConnectionBanner 的横幅语言，
 *   钉在屏幕最顶随状态在位与离场。loading 蓝条转圈不可点、error 红条点按重试、
 *   quiet 灰条说明真空态不可点。桌面屏与 App 内 WebView 失败共用本条。
 */
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Smartphone, WifiOff } from 'lucide-react-native';
import { typography, useTheme, type ColorScheme } from '../../theme/index.ts';

export type StripKind = 'loading' | 'error' | 'quiet';

interface PhoneStatusStripProps {
  kind: StripKind;
  text: string;
  /** error 条本体的点按动作，缺省不可点 */
  onPress?: () => void;
}

const PhoneStatusStrip: React.FC<PhoneStatusStripProps> = ({
  kind,
  text,
  onPress,
}) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const icon =
    kind === 'loading' ? (
      <ActivityIndicator size="small" color={colors.primary} />
    ) : kind === 'error' ? (
      <WifiOff size={18} color={colors.primaryForeground} />
    ) : (
      <Smartphone size={18} color={colors.textSecondary} />
    );
  if (kind === 'error') {
    return (
      <TouchableOpacity
        style={[styles.strip, styles.errorBg]}
        activeOpacity={0.8}
        onPress={onPress}
      >
        {icon}
        <Text style={[styles.text, styles.textError]}>{text}</Text>
      </TouchableOpacity>
    );
  }
  const quiet = kind === 'quiet';
  return (
    <View style={[styles.strip, quiet ? styles.quietBg : styles.loadingBg]}>
      {icon}
      <Text
        style={[
          styles.text,
          { color: quiet ? colors.textSecondary : colors.primary },
        ]}
      >
        {text}
      </Text>
    </View>
  );
};

/** 与 ConnectionBanner 同一行高与字重，状态切换不跳动 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    strip: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    loadingBg: {
      backgroundColor: colors.primarySelectedBackground,
    },
    errorBg: {
      backgroundColor: colors.error,
    },
    quietBg: {
      backgroundColor: colors.selectedBackground,
    },
    text: {
      flex: 1,
      ...typography.body,
      fontWeight: '600',
      color: colors.primary,
    },
    textError: {
      color: colors.primaryForeground,
    },
  });

export default PhoneStatusStrip;
