/**
 * @file CustomSendComponent.tsx
 * @description 聊天输入区域右侧的按钮组组件。
 * 空闲时为单个发送按钮，无输入内容时灰色禁用。
 * 运行中为停止加发送双按钮并存，停止中止当前回合，发送作为插话进入待注入缓冲。
 */
import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ArrowUp, Square } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ChatStatus, FileInfo } from '../../types/Chat.ts';
import { useTheme, ColorScheme } from '../../theme/index.ts';

/** 自定义发送按钮 Props */
interface CustomSendComponentProps {
  text: string;
  selectedFiles: FileInfo[];
  chatStatus: ChatStatus;
  onPress: () => void;
  onStop?: () => void;
}

const CustomSendComponent: React.FC<CustomSendComponentProps> = ({
  text,
  selectedFiles,
  chatStatus,
  onPress,
  onStop,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const isRunning = chatStatus === ChatStatus.Running;
  const canSend = text.trim().length > 0 || selectedFiles.length > 0;

  if (isRunning) {
    return (
      <View style={styles.runningGroup}>
        <TouchableOpacity
          style={styles.stopContainer}
          onPress={onStop}
          accessibilityLabel={t('chat.stop')}
        >
          <Square
            size={16}
            color={colors.primaryForeground}
            fill={colors.primaryForeground}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sendContainer, !canSend && styles.sendButtonDisabled]}
          onPress={onPress}
          disabled={!canSend}
        >
          <ArrowUp size={24} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.sendContainer, !canSend && styles.sendButtonDisabled]}
      onPress={onPress}
      disabled={!canSend}
    >
      <ArrowUp size={24} color={colors.primaryForeground} />
    </TouchableOpacity>
  );
};

/** 样式工厂函数 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    /** 运行中的双按钮容器 */
    runningGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    sendContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'flex-end',
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.text,
    },
    /** 停止按钮，红色底兼做运行指示 */
    stopContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.error,
    },
    sendButtonDisabled: {
      opacity: 0.3,
    },
  });
export default CustomSendComponent;
