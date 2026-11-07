/**
 * @file FloatingInputBar.tsx
 * @description 聊天页底部的浮动输入框组件。
 * 白底圆角卡片，纵向排列非视觉提示行、文件标签区、TextInput 和按钮行。
 * 按钮行左侧为加号按钮、右侧运行中为停止加发送双按钮，其余时间为单个发送按钮。
 * 组件内部持有文本 state，附件落定即清空，onSend 返回 false 表示被拦截，正文与草稿都保留。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChatStatus, FileInfo } from '../../types/Chat.ts';
import { ColorScheme, useTheme, typography } from '../../theme/index.ts';
import CustomSendComponent from './CustomSendComponent.tsx';
import { CustomAddFileComponent } from './CustomAddFileComponent.tsx';
import { CustomChatFooter } from './CustomChatFooter.tsx';
import type { PickedFile } from '../util/FileUtils.ts';
import { logger } from '../../lib/logger';

/** 浮动输入框 Props */
interface FloatingInputBarProps {
  textInputRef: React.RefObject<TextInput | null>;
  /** 发送动作，附件上传在此完成并落定，返回 false 表示被拦截需保留正文与草稿，消息网络发送转入后台 */
  onSend: (text: string) => Promise<boolean>;
  onStop?: () => void;
  selectedFiles: FileInfo[];
  chatStatus: ChatStatus;
  onFileSelected: (files: PickedFile[]) => void;
  onRemoveFile: (id: string) => void;
  onRetryFile: (id: string) => void;
  /** 草稿含图且当前模型不支持视觉时的提示行 */
  showNoVisionHint?: boolean;
}

const FloatingInputBar: React.FC<FloatingInputBarProps> = ({
  textInputRef,
  onSend,
  onStop,
  selectedFiles,
  chatStatus,
  onFileSelected,
  onRemoveFile,
  onRetryFile,
  showNoVisionHint,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [text, setText] = useState('');

  /** 发送点击。运行中同样放行，忙时插话语义由 chatStore 分流，流程异常兜底保留正文 */
  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 && selectedFiles.length === 0) {
      return;
    }
    let sent = false;
    try {
      sent = await onSend(trimmed);
    } catch (e) {
      logger.warn(
        `[inputBox] send flow threw: ${e instanceof Error ? e.message : e}`
      );
    }
    if (sent) {
      // clear 命令更新原生输入控件的内部状态并触发重新量高，只改 value 属性不会触发。
      textInputRef.current?.clear();
      setText('');
      logger.info('[inputBox] input cleared after send accepted');
    }
  }, [text, selectedFiles.length, onSend, textInputRef]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        {showNoVisionHint && (
          <Text style={styles.noVisionHint}>{t('chat.modelNoVision')}</Text>
        )}
        <CustomChatFooter
          files={selectedFiles}
          onRemoveFile={onRemoveFile}
          onRetryFile={onRetryFile}
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
            onStop={onStop}
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
    /** 非视觉模型的降级提示行，只提示不拦截发送 */
    noVisionHint: {
      ...typography.body,
      color: colors.textSecondary,
      paddingBottom: 6,
    },
    textInput: {
      color: colors.text,
      ...typography.bodyLg,
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
