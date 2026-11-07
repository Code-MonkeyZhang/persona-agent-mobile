/**
 * @file PressableRow.tsx
 * @description 通用行按压容器,主页聊天入口、工具、技能与会话行四类入口共用。
 *   按下背景换 colors.surface 浅灰,抬起复原,口径与 demo 会话行的按压反馈一致。
 *   长按与点击只透传回调,不拦截手势,会话行的长按菜单由外层 MenuView 接管。
 */
import * as React from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../theme/index.ts';

interface PressableRowProps {
  onPress: () => void;
  /** 长按回调,会话行经 MenuView 接管时不传 */
  onLongPress?: () => void;
  /** 行样式,按压背景叠加在其上 */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** 行按压容器,按下换浅灰背景,四类入口的按压手感统一收在这里 */
export function PressableRow({
  onPress,
  onLongPress,
  style,
  children,
}: PressableRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        style,
        pressed && { backgroundColor: colors.surface },
      ]}
    >
      {children}
    </Pressable>
  );
}
