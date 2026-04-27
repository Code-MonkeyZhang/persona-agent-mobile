/**
 * @file HeaderLeftView.tsx
 * @description 导航栏左侧返回按钮组件。
 * 渲染一个返回箭头图标，点击时调用 navigation.goBack() 返回上一页。
 * 根据深色/浅色模式切换图标颜色。
 */
import React from 'react';
import { TouchableOpacity, Image, StyleSheet } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { RouteParamList } from '../types/RouteTypes.ts';

type NavigationProp = DrawerNavigationProp<RouteParamList>;

/**
 * 导航栏左侧返回按钮。
 * @param navigation Drawer 导航器实例，用于调用 goBack()
 * @param isDark 是否深色模式，决定箭头图标颜色
 */
export const HeaderLeftView = (navigation: NavigationProp, isDark: boolean) => {
  return (
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      style={styles.headerContainer}
    >
      <Image
        source={
          isDark
            ? require('../assets/back_dark.png')
            : require('../assets/back.png')
        }
        style={styles.headerImage}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    marginLeft: -10,
    paddingRight: 16,
    padding: 10,
  },
  headerImage: { width: 20, height: 20 },
});
