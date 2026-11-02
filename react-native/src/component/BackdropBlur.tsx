/**
 * @file component/BackdropBlur.tsx
 * @description 面板背景模糊层的统一渲染入口，聊天输入区与直播条共用。
 *   iOS 走 @sbaiahmed1/react-native-blur 的原生毛玻璃，组件在编译期静态注册，
 *   消除 expo-blur 运行时登记竞态导致的偶发红色占位视图。
 *   安卓保持半透明白降级底色，与历史视觉一致，不启用真模糊。
 */
import { useEffect } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from '@sbaiahmed1/react-native-blur';

import { logger } from '../lib/logger.ts';

/** 安卓降级底色，取 expo-blur light 档强度 40 的降级色值，保持历史观感 */
const ANDROID_FALLBACK_COLOR = 'rgba(249,249,249,0.31)';

/** 每次运行只记一次挂载日志，避免反复进出聊天页刷屏 */
let mountLogDone = false;

export interface BackdropBlurProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * 铺满父容器的背景模糊层。
 * - iOS 渲染原生毛玻璃，blurAmount 与原 expo-blur intensity 同量程
 * - 安卓渲染半透明底色，视觉与 expo-blur 降级路径一致
 */
function BackdropBlur({ style }: BackdropBlurProps) {
  useEffect(() => {
    if (!mountLogDone) {
      mountLogDone = true;
      logger.debug(`[BackdropBlur] first mount on ${Platform.OS}`);
    }
  }, []);

  if (Platform.OS === 'android') {
    return <View style={[StyleSheet.absoluteFill, style, styles.fallback]} />;
  }
  return (
    <BlurView
      blurType="light"
      blurAmount={40}
      ignoreSafeArea={false}
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: ANDROID_FALLBACK_COLOR },
});

export default BackdropBlur;
