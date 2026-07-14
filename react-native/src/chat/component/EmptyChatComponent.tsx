/**
 * @file EmptyChatComponent.tsx
 * @description 聊天页面无消息时的简短提示。
 * 加载状态显示旋转加载动画。
 * 注意：GiftedChat 的列表是倒序渲染的（最新消息在顶部），
 * 所以需要 scaleY: -1 来翻转布局方向。
 */
import React from 'react';
import { Text, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from './LoadingSpinner.tsx';
import { useTheme, ColorScheme } from '../../theme/index.ts';

const isAndroid = Platform.OS === 'android';

/** 空聊天页面 Props */
interface EmptyChatComponentProps {
  /** 是否正在加载历史消息 */
  isLoadingMessages?: boolean;
}

export const EmptyChatComponent = ({
  isLoadingMessages = false,
}: EmptyChatComponentProps): React.ReactElement => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  return (
    <View style={styles.emptyChatContainer}>
      {isLoadingMessages ? (
        <LoadingSpinner visible={true} size={28} />
      ) : (
        <Text style={styles.hintText}>{t('chat.startConversation')}</Text>
      )}
    </View>
  );
};

/** 样式工厂函数 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    emptyChatContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      flex: 1,
    },
    hintText: {
      fontSize: 19,
      fontWeight: '500',
      paddingHorizontal: 16,
      textAlign: 'center',
      color: colors.textDarkGray,
      transform: [{ scaleY: -1 }, { scaleX: isAndroid ? -1 : 1 }],
    },
  });
