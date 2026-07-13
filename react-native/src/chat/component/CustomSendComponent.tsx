/**
 * @file CustomSendComponent.tsx
 * @description 聊天输入区域右侧的发送按钮组件。
 * 根据聊天状态和输入内容，在三种形态之间切换：
 * - AI 回复中：显示停止按钮
 * - 有输入文本/附件：显示发送按钮
 * - 空闲无输入：显示灰色禁用状态的发送按钮
 */
import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
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
  /** 停止按钮回调：中断 AI 回复 */
  onStopPress: () => void;
}

const CustomSendComponent: React.FC<CustomSendComponentProps> = ({
  text,
  selectedFiles,
  chatStatus,
  onPress,
  onStopPress,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const isRunning = chatStatus === ChatStatus.Running;
  const isActive = text.length > 0 || selectedFiles.length > 0;

  if (isRunning) {
    return (
      <TouchableOpacity style={styles.stopContainer} onPress={onStopPress}>
        <View style={styles.circle} />
        <View style={styles.rectangle} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.sendContainer, !isActive && styles.sendButtonDisabled]}
      onPress={onPress}
      disabled={!isActive}
    >
      <ArrowUp size={20} color="#ffffff" />
    </TouchableOpacity>
  );
};

/** 样式工厂函数 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    stopContainer: {
      width: 26,
      height: 26,
      justifyContent: 'center',
      alignItems: 'center',
    },
    circle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.text,
      position: 'absolute',
    },
    rectangle: {
      width: 10,
      height: 10,
      backgroundColor: colors.surface,
      borderRadius: 2,
      position: 'absolute',
    },
    sendContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'flex-end',
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.text,
    },
    sendButtonDisabled: {
      opacity: 0.3,
    },
  });
export default CustomSendComponent;
