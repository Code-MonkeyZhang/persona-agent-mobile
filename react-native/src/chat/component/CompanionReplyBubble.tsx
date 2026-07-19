/**
 * @file component/CompanionReplyBubble.tsx
 * @description 陪伴模式下浮在输入框上方的 AI 回复气泡。
 */
import React from 'react';
import { View, ScrollView, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ColorScheme } from '../../theme/index';

const createBubbleStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    outer: {
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    inner: {
      borderRadius: 24,
      backgroundColor: colors.surfaceTranslucent,
      borderWidth: 1,
      borderColor: colors.overlayLight,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 4,
    },
    scroll: {
      maxHeight: 160,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
    },
    text: {
      fontSize: 17,
      color: colors.textDarkGray,
      lineHeight: 26,
    },
    thinking: {
      fontSize: 16,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
  });

interface CompanionReplyBubbleProps {
  messageKey: string | undefined;
  text: string;
  isThinking: boolean;
  thinkingText: string;
  colors: ColorScheme;
}

export function CompanionReplyBubble({
  messageKey,
  text,
  isThinking,
  thinkingText,
  colors,
}: CompanionReplyBubbleProps) {
  const styles = createBubbleStyles(colors);
  return (
    <Animated.View
      key={messageKey}
      entering={FadeInDown.duration(350)}
      style={styles.outer}
    >
      <View style={styles.inner}>
        {isThinking ? (
          <Text style={styles.thinking}>{thinkingText}</Text>
        ) : (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <Text style={styles.text}>{text}</Text>
          </ScrollView>
        )}
      </View>
    </Animated.View>
  );
}
