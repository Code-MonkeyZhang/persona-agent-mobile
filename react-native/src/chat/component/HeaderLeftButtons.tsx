/**
 * @file component/HeaderLeftButtons.tsx
 * @description 头部左侧按钮组：返回键 + 语音开关。
 *   返回键贴屏幕左缘并压低高度，对齐 iOS 原生返回键的位置习惯。
 *   语音开关永远可点，开着且能力缺失时图标整体转琥珀色，点亮与播报期为主色。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ChevronLeft, Volume2, VolumeX } from 'lucide-react-native';
import { ColorScheme } from '../../theme/index';
import { CustomHeaderRightButton } from './CustomHeaderRightButton';

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
  /** 返回键内边距，左缘收紧使箭头贴近屏幕边缘 */
  back: { paddingLeft: 6, paddingRight: 10, paddingVertical: 8 },
});

/** 能力缺失时的警示色，与设计定稿的琥珀色同源 */
const WARN_COLOR = '#b45309';

interface HeaderLeftButtonsProps {
  voiceEnabled: boolean;
  voiceReady: boolean | null;
  onToggleVoice: () => void;
  onBack: () => void;
  colors: ColorScheme;
}

export function HeaderLeftButtons({
  voiceEnabled,
  voiceReady,
  onToggleVoice,
  onBack,
  colors,
}: HeaderLeftButtonsProps) {
  const voiceColor = !voiceEnabled
    ? colors.textSecondary
    : voiceReady === false
    ? WARN_COLOR
    : colors.primary;
  return (
    <View style={styles.root}>
      <CustomHeaderRightButton onPress={onBack} style={styles.back}>
        <ChevronLeft size={26} color={colors.text} />
      </CustomHeaderRightButton>
      <CustomHeaderRightButton onPress={onToggleVoice}>
        {voiceEnabled ? (
          <Volume2 size={24} color={voiceColor} />
        ) : (
          <VolumeX size={24} color={voiceColor} />
        )}
      </CustomHeaderRightButton>
    </View>
  );
}
