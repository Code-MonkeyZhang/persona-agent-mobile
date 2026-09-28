/**
 * @file component/HeaderLeftButtons.tsx
 * @description 头部左侧按钮组：返回键 + 语音开关。
 *   返回键贴屏幕左缘并压低高度，对齐 iOS 原生返回键的位置习惯。
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

interface HeaderLeftButtonsProps {
  voiceEnabled: boolean;
  isSpeaking: boolean;
  onToggleVoice: () => void;
  onBack: () => void;
  colors: ColorScheme;
}

export function HeaderLeftButtons({
  voiceEnabled,
  isSpeaking,
  onToggleVoice,
  onBack,
  colors,
}: HeaderLeftButtonsProps) {
  return (
    <View style={styles.root}>
      <CustomHeaderRightButton onPress={onBack} style={styles.back}>
        <ChevronLeft size={26} color={colors.text} />
      </CustomHeaderRightButton>
      <CustomHeaderRightButton onPress={onToggleVoice}>
        {voiceEnabled ? (
          <Volume2
            size={24}
            color={isSpeaking ? colors.primary : colors.text}
          />
        ) : (
          <VolumeX size={24} color={colors.textSecondary} />
        )}
      </CustomHeaderRightButton>
    </View>
  );
}
