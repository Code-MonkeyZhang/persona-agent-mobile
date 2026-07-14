/**
 * @file CustomSendComponent.tsx
 * @description 聊天输入区域右侧的发送按钮组件。
 * AI 回复中或无输入内容时显示灰色禁用状态，有输入时显示可点击的发送按钮。
 */
import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import { ChatStatus, FileInfo } from '../../types/Chat.ts';
import { useTheme, ColorScheme } from '../../theme/index.ts';

/** 自定义发送按钮 Props */
interface CustomSendComponentProps {
  /** 当前输入文本 */
  text: string;
  /** 已选中的附件文件列表 */
  selectedFiles: FileInfo[];
  /** 当前聊天状态（空闲/回复中/完成） */
  chatStatus: ChatStatus;
  /** 发送按钮回调 */
  onPress: () => void;
}

const CustomSendComponent: React.FC<CustomSendComponentProps> = ({
  text,
  selectedFiles,
  chatStatus,
  onPress,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const isRunning = chatStatus === ChatStatus.Running;
  const isActive = !isRunning && (text.length > 0 || selectedFiles.length > 0);

  return (
    <TouchableOpacity
      style={[styles.sendContainer, !isActive && styles.sendButtonDisabled]}
      onPress={onPress}
      disabled={!isActive}
    >
      <ArrowUp size={24} color={colors.primaryForeground} />
    </TouchableOpacity>
  );
};

/** 样式工厂函数 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    sendContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'flex-end',
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.text,
    },
    sendButtonDisabled: {
      opacity: 0.3,
    },
  });
export default CustomSendComponent;
