import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ChatStatus,
  FileInfo,
} from '../../types/Chat.ts';
import {
  CustomFileListComponent,
  DisplayMode,
} from './CustomFileListComponent.tsx';
import { isAndroid, isMacCatalyst } from '../../utils/PlatformUtils.ts';

interface CustomComposerProps {
  files: FileInfo[];
  onFileUpdated: (files: FileInfo[], isUpdate?: boolean) => void;
  hasInputText?: boolean;
  chatStatus?: ChatStatus;
}

export const CustomChatFooter: React.FC<CustomComposerProps> = ({
  files,
  onFileUpdated,
  hasInputText = false,
  chatStatus,
}) => {
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
          ...(isMacCatalyst && {
            paddingBottom: 18,
          }),
        }}>
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
