/**
 * @file CustomChatFooter.tsx
 * @description 聊天输入框底部的文件附件区域。
 * 在编辑模式下显示已选文件列表（带删除按钮和添加按钮），
 * 在显示模式下只读展示消息中的附件。
 * 当有输入文本或 AI 正在回复时，自动隐藏文件列表但保留容器高度以防布局跳动。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ChatStatus, FileInfo } from '../../types/Chat.ts';
import {
  CustomFileListComponent,
  DisplayMode,
} from './CustomFileListComponent.tsx';

/** 聊天底部区域 Props */
interface CustomComposerProps {
  /** 当前已选中的附件文件列表 */
  files: FileInfo[];
  /** 文件更新回调（删除、添加、压缩完成等场景触发） */
  onFileUpdated: (files: FileInfo[], isUpdate?: boolean) => void;
  /** 输入框是否有文本，有文本时隐藏文件列表 */
  hasInputText?: boolean;
  /** 当前聊天状态 */
  chatStatus?: ChatStatus;
}

export const CustomChatFooter: React.FC<CustomComposerProps> = ({
  files,
  onFileUpdated,
  hasInputText = false,
  chatStatus,
}) => {
  /**
   * 当有输入文本或 AI 正在回复时，隐藏文件列表的可视区域，
   * 但保留容器高度，避免收起时布局跳动。
   * 实际的隐藏逻辑在 CustomFileListComponent 内部处理（opacity + absolute 定位）。
   */
  const isHideFileList = hasInputText || chatStatus === ChatStatus.Running;

  return (
    <>
      <View
        style={{
          ...styles.container,
          ...(files.length > 0 && {
            height: 136,
          }),
          ...(files.length === 0 && {
            height: 0,
          }),
        }}
      >
        {(isHideFileList || files.length > 0) && (
          <CustomFileListComponent
            files={files}
            onFileUpdated={onFileUpdated}
            mode={DisplayMode.Edit}
            isHideFileList={isHideFileList}
          />
        )}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
  },
});
