import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { LoaderCircle } from 'lucide-react-native';
import { useTheme } from '../../theme/index.ts';

interface LoadingSpinnerProps {
  size?: number;
  visible: boolean;
}

/**
 * 旋转加载动画组件，使用 lucide LoaderCircle 图标配合 reanimated 旋转动画。
 */
const LoadingSpinner = ({ size = 24, visible }: LoadingSpinnerProps) => {
  const { colors } = useTheme();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, {
          duration: 600,
          easing: Easing.linear,
        }),
        -1,
        false
      );
    } else {
      cancelAnimation(rotation);
    }

    return () => {
      cancelAnimation(rotation);
    };
  }, [visible, rotation]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotateZ: `${rotation.value}deg` }],
    };
  });

  if (!visible) {
    return null;
  }

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View style={animatedStyle}>
        <LoaderCircle size={size} color={colors.textSecondary} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default LoadingSpinner;
