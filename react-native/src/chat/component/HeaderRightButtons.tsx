/**
 * @file component/HeaderRightButtons.tsx
 * @description 头部右侧按钮组：语音开关 + 陪伴面板开关。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { UserRound, Mic, MicOff } from 'lucide-react-native';
import { ColorScheme } from '../../theme/index';
import { CustomHeaderRightButton } from './CustomHeaderRightButton';

const headerRightContainerStyle = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
});

interface HeaderRightButtonsProps {
  voiceEnabled: boolean;
  isSpeaking: boolean;
  companionOpen: boolean;
  onToggleVoice: () => void;
  onToggleCompanion: () => void;
  colors: ColorScheme;
}

export function HeaderRightButtons({
  voiceEnabled,
  isSpeaking,
  companionOpen,
  onToggleVoice,
  onToggleCompanion,
  colors,
}: HeaderRightButtonsProps) {
  return (
    <View style={headerRightContainerStyle.root}>
      <CustomHeaderRightButton onPress={onToggleVoice}>
        {voiceEnabled ? (
          <Mic size={24} color={isSpeaking ? colors.primary : colors.text} />
        ) : (
          <MicOff size={24} color={colors.text} />
        )}
      </CustomHeaderRightButton>
      <CustomHeaderRightButton onPress={onToggleCompanion}>
        <UserRound
          size={26}
          color={companionOpen ? colors.primary : colors.text}
        />
      </CustomHeaderRightButton>
    </View>
  );
}
