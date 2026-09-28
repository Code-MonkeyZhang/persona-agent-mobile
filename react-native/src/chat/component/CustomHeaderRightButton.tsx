import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
  StyleProp,
  ViewStyle,
} from 'react-native';

/**
 * Props for the CustomHeaderRightButton component
 */
interface HeaderRightButtonProps {
  onPress: (event: GestureResponderEvent) => void;
  children?: React.ReactNode;
  /** 覆盖默认内边距的样式，传入时叠在默认值之后生效 */
  style?: StyleProp<ViewStyle>;
}

/**
 * 通用 Header 右侧按钮。
 */
export const CustomHeaderRightButton: React.FC<HeaderRightButtonProps> =
  React.memo(({ onPress, children, style }) => (
    <TouchableOpacity onPress={onPress} style={[styles.touchStyle, style]}>
      {children}
    </TouchableOpacity>
  ));

const styles = StyleSheet.create({
  touchStyle: {
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
});
