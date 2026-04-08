import { Send, SendProps } from 'react-native-gifted-chat';
import React, { useMemo, useCallback } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import {
  ChatMode,
  ChatStatus,
  FileInfo,
  SwiftChatMessage,
} from '../../types/Chat.ts';
import { CustomAddFileComponent } from './CustomAddFileComponent.tsx';
import { useTheme, ColorScheme } from '../../theme';

interface CustomSendComponentProps extends SendProps<SwiftChatMessage> {
  chatStatus: ChatStatus;
  chatMode: ChatMode;
  selectedFiles: FileInfo[];
  onStopPress: () => void;
  onFileSelected: (files: FileInfo[]) => void;
}

const CustomSendComponent: React.FC<CustomSendComponentProps> = ({
  chatStatus,
  chatMode,
  selectedFiles,
  onStopPress,
  onFileSelected,
  ...props
}) => {
  const { text, onSend } = props;
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleSend = useCallback(() => {
    if (onSend) {
      onSend(
        { text: text ? text.trim() : '' } as Partial<SwiftChatMessage>,
        true
      );
    }
  }, [onSend, text]);

  const handleFileSelected = useCallback(
    (files: FileInfo[]) => {
      onFileSelected(files);
    },
    [onFileSelected]
  );

  const isShowSending =
    chatMode === ChatMode.Text &&
    ((text && text.length > 0) ||
      selectedFiles.length > 0 ||
      chatStatus === ChatStatus.Running);

  if (isShowSending) {
    return (
      <Send
        {...props}
        containerStyle={styles.sendContainer}
        sendButtonProps={{
          onPress: handleSend,
        }}>
        <>
          {chatStatus === ChatStatus.Running && (
            <TouchableOpacity
              style={styles.stopContainer}
              onPress={() => onStopPress()}>
              <View style={styles.circle} />
              <View style={styles.rectangle} />
            </TouchableOpacity>
          )}
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
    return (
      <CustomAddFileComponent
        {...props}
        onFileSelected={handleFileSelected}
      />
    );
  }
};

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
