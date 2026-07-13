/**
 * @file FloatingInputBar.tsx
 * @description 聊天页底部的浮动输入框组件。
 * 白底圆角卡片，纵向排列文件标签区、TextInput 和按钮行。
 * 按钮行左侧为加号按钮、右侧为发送/停止按钮。
 * 组件内部持有文本 state，通过 onSend 回调通知 ChatScreen 发送消息。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChatStatus, FileInfo } from '../../types/Chat.ts';
import { ColorScheme, useTheme } from '../../theme/index.ts';
import CustomSendComponent from './CustomSendComponent.tsx';
import { CustomAddFileComponent } from './CustomAddFileComponent.tsx';
import { CustomChatFooter } from './CustomChatFooter.tsx';

/** 浮动输入框 Props */
interface FloatingInputBarProps {
  /** ChatScreen 转发的 TextInput ref，用于 focus/clear 控制 */
  textInputRef: React.RefObject<TextInput>;
  /** 发送消息回调 */
  onSend: (text: string) => void;
  /** 已选中的附件文件列表 */
  selectedFiles: FileInfo[];
  /** 当前聊天状态 */
  chatStatus: ChatStatus;
  /** 停止按钮回调：中断 AI 回复 */
  onStopPress: () => void;
  /** 新文件选择回调，由 CustomAddFileComponent 触发 */
  onFileSelected: (files: FileInfo[]) => void;
  /** 文件删除/压缩更新回调，由 CustomChatFooter 触发 */
  onFileUpdated: (files: FileInfo[], isUpdate?: boolean) => void;
}

const FloatingInputBar: React.FC<FloatingInputBarProps> = ({
  textInputRef,
  onSend,
  selectedFiles,
  chatStatus,
  onStopPress,
  onFileSelected,
  onFileUpdated,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0 && selectedFiles.length === 0) {
      return;
    }
    if (chatStatus === ChatStatus.Running) {
      return;
    }
    onSend(trimmed);
    setText('');
  }, [text, selectedFiles, chatStatus, onSend]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        <CustomChatFooter
          files={selectedFiles}
          onFileUpdated={onFileUpdated}
          hasInputText={text.length > 0}
          chatStatus={chatStatus}
        />
        <TextInput
          ref={textInputRef}
          style={styles.textInput}
          value={text}
          onChangeText={setText}
          placeholder={t('chat.typeMessage')}
          placeholderTextColor={colors.placeholder}
          multiline
          blurOnSubmit={false}
        />
        <View style={styles.buttonRow}>
          <CustomAddFileComponent onFileSelected={onFileSelected} />
          <CustomSendComponent
            text={text}
            selectedFiles={selectedFiles}
            chatStatus={chatStatus}
            onPress={handleSend}
            onStopPress={onStopPress}
          />
        </View>
      </View>
    </View>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    wrapper: {
      paddingHorizontal: 12,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    textInput: {
      color: colors.text,
      fontSize: 16,
      fontWeight: 'normal',
      maxHeight: 200,
      textAlignVertical: 'top',
    },
    /** 底部按钮行：加号在左，发送在右 */
    buttonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
    },
  });

export default FloatingInputBar;
