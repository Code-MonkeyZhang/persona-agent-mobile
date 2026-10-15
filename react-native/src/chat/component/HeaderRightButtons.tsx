/**
 * @file component/HeaderRightButtons.tsx
 * @description 头部右侧按钮组：陪伴面板开关 + 小手机桌面入口。
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { UserRound, Smartphone } from 'lucide-react-native';
import { ColorScheme } from '../../theme/index';
import { CustomHeaderRightButton } from './CustomHeaderRightButton';

const headerRightContainerStyle = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
});

interface HeaderRightButtonsProps {
  companionOpen: boolean;
  onToggleCompanion: () => void;
  onOpenAgentApp: () => void;
  colors: ColorScheme;
}

export function HeaderRightButtons({
  companionOpen,
  onToggleCompanion,
  onOpenAgentApp,
  colors,
}: HeaderRightButtonsProps) {
  return (
    <View style={headerRightContainerStyle.root}>
      <CustomHeaderRightButton onPress={onToggleCompanion}>
        <UserRound
          size={26}
          color={companionOpen ? colors.primary : colors.text}
        />
      </CustomHeaderRightButton>
      <CustomHeaderRightButton onPress={onOpenAgentApp}>
        <Smartphone size={24} color={colors.text} />
      </CustomHeaderRightButton>
    </View>
  );
}
