/**
 * @file component/HeaderLeftButtons.tsx
 * @description 头部左侧按钮组：抽屉开关 + 语音开关。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Menu, Volume2, VolumeX } from 'lucide-react-native';
import { ColorScheme } from '../../theme/index';
import { CustomHeaderRightButton } from './CustomHeaderRightButton';

const containerStyle = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
});

interface HeaderLeftButtonsProps {
  voiceEnabled: boolean;
  isSpeaking: boolean;
  onToggleVoice: () => void;
  onToggleDrawer: () => void;
  colors: ColorScheme;
}

export function HeaderLeftButtons({
  voiceEnabled,
  isSpeaking,
  onToggleVoice,
  onToggleDrawer,
  colors,
}: HeaderLeftButtonsProps) {
  return (
    <View style={containerStyle.root}>
      <CustomHeaderRightButton onPress={onToggleDrawer}>
        <Menu size={26} color={colors.text} />
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
