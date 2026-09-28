/**
 * @file TypingDots.tsx
 * @description 生成中的运行指示组件。
 * 三个小点错峰跳动，会话运行时显示在标题旁，消息流内不再有占位气泡。
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/index.ts';

const DOT_COUNT = 3;
const DOT_DELAY_STEP = 200;

export function TypingDots() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const animations = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.3))
  ).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.stagger(
        DOT_DELAY_STEP,
        animations.map((anim) =>
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0.3,
              duration: 300,
              useNativeDriver: true,
            }),
          ])
        )
      )
    );
    animation.start();
    return () => animation.stop();
  }, [animations]);

  return (
    <View style={styles.row} accessibilityLabel={t('chat.generating')}>
      {animations.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            { backgroundColor: colors.primary, opacity: anim },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
