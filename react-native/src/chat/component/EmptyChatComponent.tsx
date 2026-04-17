/**
 * @file EmptyChatComponent.tsx
 * @description 聊天页面无消息时的欢迎界面。
 * - 正常状态：显示 "Hi, I'm AI" 文字，点击可跳转设置页
 * - 加载状态：显示旋转加载动画
 * 注意：GiftedChat 的列表是倒序渲染的（最新消息在顶部），
 * 所以需要 scaleY: -1 来翻转布局方向。
 */
import React from 'react';
import {
  Text,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import LoadingSpinner from './LoadingSpinner';
import { useNavigation } from '@react-navigation/native';
import { RouteParamList } from '../../types/RouteTypes.ts';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useTheme, ColorScheme } from '../../theme';

const isAndroid = Platform.OS === 'android';
type NavigationProp = DrawerNavigationProp<RouteParamList>;

/** 空聊天页面 Props */
interface EmptyChatComponentProps {
  /** 是否正在加载历史消息 */
  isLoadingMessages?: boolean;
}

export const EmptyChatComponent = ({
  isLoadingMessages = false,
}: EmptyChatComponentProps): React.ReactElement => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();

  const styles = createStyles(colors);

  return (
    <View style={styles.emptyChatContainer}>
      {/* 点击欢迎文字/加载动画可跳转到设置页 */}
      <TouchableOpacity
        onPress={() => {
          navigation.navigate('Settings', {});
        }}
      >
        {isLoadingMessages ? (
          <LoadingSpinner
            visible={true}
            size={24}
            isRotate={!isAndroid}
            source={require('../../assets/loading.png')}
          />
        ) : (
          <Text style={styles.greetingText}>Hi, I&apos;m AI</Text>
        )}
      </TouchableOpacity>
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
    greetingText: {
      fontSize: 16,
      fontWeight: '500',
      paddingHorizontal: 16,
      textAlign: 'center',
      color: colors.textDarkGray,
      transform: [{ scaleY: -1 }, { scaleX: isAndroid ? -1 : 1 }],
    },
  });
