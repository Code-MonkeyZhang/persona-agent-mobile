import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import {
  ChatStatus,
  FileInfo,
} from '../../types/Chat.ts';
import {
  CustomFileListComponent,
  DisplayMode,
} from './CustomFileListComponent.tsx';
import { ModelIconButton } from './ModelIconButton.tsx';
import { ModelSelectionModal } from './ModelSelectionModal.tsx';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAndroid, isMacCatalyst } from '../../utils/PlatformUtils.ts';

interface CustomComposerProps {
  files: FileInfo[];
  onFileUpdated: (files: FileInfo[], isUpdate?: boolean) => void;
  onSwitchedToTextModel: () => void;
  hasInputText?: boolean;
  chatStatus?: ChatStatus;
}

export const CustomChatFooter: React.FC<CustomComposerProps> = ({
  files,
  onFileUpdated,
  onSwitchedToTextModel,
  hasInputText = false,
  chatStatus,
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [iconPosition, setIconPosition] = useState({ x: 0, y: 0 });
  const modelIconRef = useRef<View>(null);
  const iconPositionRef = useRef({ x: 0, y: 0 });
  const insets = useSafeAreaInsets();
  const statusBarHeight = useRef(insets.top);

  const handleOpenModal = () => {
    if (iconPositionRef.current.y === 0) {
      modelIconRef.current?.measure((x, y, width, height, pageX, pageY) => {
        iconPositionRef.current = {
          x: pageX,
          y: pageY + 10 + (isAndroid ? statusBarHeight.current : 0),
        };
        setIconPosition(iconPositionRef.current);
        setModalVisible(true);
      });
    } else {
      setModalVisible(true);
    }
  };

  useEffect(() => {
    Keyboard.addListener('keyboardWillShow', () => {
      modelIconRef.current?.measure((x, y, width, height, pageX, pageY) => {
        if (iconPositionRef.current.y === 0) {
          iconPositionRef.current = {
            x: pageX,
            y: pageY + 10 + (isAndroid ? statusBarHeight.current : 0),
          };
          setIconPosition(iconPositionRef.current);
        }
      });
    });
  }, []);

  const handleCloseModal = () => {
    setModalVisible(false);
  };
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
            height: 60,
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
        <View
            style={{
              ...styles.promptContainer,
              ...(files.length > 0 && {
                marginTop: -72,
              }),
            }}>
            <View ref={modelIconRef} collapsable={false}>
              <ModelIconButton onPress={handleOpenModal} />
            </View>
          </View>
      </View>
      <ModelSelectionModal
        visible={modalVisible}
        onClose={handleCloseModal}
        iconPosition={iconPosition}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
  },
  promptContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
    marginBottom: isAndroid ? 12 : 0,
  },
});
