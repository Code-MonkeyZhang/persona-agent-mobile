import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';

/**
 * Props for the CustomHeaderRightButton component
 */
interface HeaderRightButtonProps {
  onPress: (event: GestureResponderEvent) => void;
  /** 自定义图标节点 */
  children?: React.ReactNode;
}

/**
 * 通用 Header 右侧按钮。
 */
export const CustomHeaderRightButton: React.FC<HeaderRightButtonProps> =
  React.memo(({ onPress, children }) => (
    <TouchableOpacity onPress={onPress} style={styles.touchStyle}>
      {children}
    </TouchableOpacity>
  ));

const styles = StyleSheet.create({
  touchStyle: {
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
});
