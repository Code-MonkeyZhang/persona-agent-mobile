/**
 * @file CustomSendComponent.tsx
 * @description 聊天输入区域右侧的操作按钮组件。
 * 根据聊天状态和输入内容，在三种形态之间切换：
 * - 有输入文本/附件或正在回复时：显示发送按钮（回复中变为停止按钮）
 * - 无输入且空闲时：显示附件添加按钮（CustomAddFileComponent）
 */
import { Send, SendProps } from 'react-native-gifted-chat';
import React, { useMemo, useCallback } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ChatStatus, FileInfo, ChatMessage } from '../../types/Chat.ts';
import { CustomAddFileComponent } from './CustomAddFileComponent.tsx';
import { useTheme, ColorScheme } from '../../theme/index.ts';

/** 自定义发送按钮 Props */
interface CustomSendComponentProps extends SendProps<ChatMessage> {
  /** 当前聊天状态（空闲/回复中/完成） */
  chatStatus: ChatStatus;
  /** 已选中的附件文件列表 */
  selectedFiles: FileInfo[];
  /** 停止按钮回调：中断 AI 回复 */
  onStopPress: () => void;
  /** 文件选择回调：用户添加附件后触发 */
  onFileSelected: (files: FileInfo[]) => void;
}

const CustomSendComponent: React.FC<CustomSendComponentProps> = ({
  chatStatus,
  selectedFiles,
  onStopPress,
  onFileSelected,
  ...props
}) => {
  const { text, onSend } = props;
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  /** 点击发送：将输入文本 trim 后通过 GiftedChat 的 onSend 回调发出 */
  const handleSend = useCallback(() => {
    if (onSend) {
      onSend({ text: text ? text.trim() : '' } as Partial<ChatMessage>, true);
    }
  }, [onSend, text]);

  /** 文件选择回调透传 */
  const handleFileSelected = useCallback(
    (files: FileInfo[]) => {
      onFileSelected(files);
    },
    [onFileSelected]
  );

  /**
   * 判断是否显示发送按钮区域（而非附件按钮）：
   * 有输入文本、有附件、或正在回复中时显示
   */
  const isShowSending =
    (text && text.length > 0) ||
    selectedFiles.length > 0 ||
    chatStatus === ChatStatus.Running;

  if (isShowSending) {
    return (
      <Send
        {...props}
        containerStyle={styles.sendContainer}
        sendButtonProps={{
          onPress: handleSend,
        }}
      >
        <>
          {/* AI 回复中：显示停止按钮（圆形 + 方块图标） */}
          {chatStatus === ChatStatus.Running && (
            <TouchableOpacity
              style={styles.stopContainer}
              onPress={() => onStopPress()}
            >
              <View style={styles.circle} />
              <View style={styles.rectangle} />
            </TouchableOpacity>
          )}
          {/* 空闲状态：显示发送箭头图标 */}
          {chatStatus !== ChatStatus.Running && (
            <Image
              source={
                isDark
                  ? require('../../assets/send_dark.png')
                  : require('../../assets/send.png')
              }
              style={styles.sendButton}
            />
          )}
        </>
      </Send>
    );
  } else {
    /** 无输入内容且空闲时：显示附件添加按钮 */
    return (
      <CustomAddFileComponent {...props} onFileSelected={handleFileSelected} />
    );
  }
};

/** 样式工厂函数 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    stopContainer: {
      marginRight: 10,
      marginLeft: 10,
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
    },
    sendButton: {
      width: 26,
      height: 26,
      borderRadius: 15,
      marginRight: 10,
      marginLeft: 10,
    },
  });
export default CustomSendComponent;
