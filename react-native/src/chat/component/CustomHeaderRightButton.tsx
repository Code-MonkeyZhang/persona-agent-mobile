import React from 'react';
import {
  TouchableOpacity,
  Image,
  StyleSheet,
  GestureResponderEvent,
  ImageSourcePropType,
} from 'react-native';

/**
 * Props for the CustomHeaderRightButton component
 */
interface HeaderRightButtonProps {
  onPress: (event: GestureResponderEvent) => void;
  /** 图片资源（与 children 二选一） */
  imageSource?: ImageSourcePropType;
  /** 自定义图标节点（与 imageSource 二选一） */
  children?: React.ReactNode;
}

/**
 * 通用 Header 右侧按钮：支持图片资源或自定义图标节点。
 */
export const CustomHeaderRightButton: React.FC<HeaderRightButtonProps> =
  React.memo(({ onPress, imageSource, children }) => (
    <TouchableOpacity onPress={onPress} style={styles.touchStyle}>
      {children ??
        (imageSource && (
          <Image source={imageSource} style={styles.editImage} />
        ))}
    </TouchableOpacity>
  ));

const styles = StyleSheet.create({
  touchStyle: {
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
  editImage: {
    width: 22,
    height: 22,
  },
});
