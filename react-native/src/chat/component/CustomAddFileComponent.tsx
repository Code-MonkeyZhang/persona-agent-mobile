/**
 * @file CustomAddFileComponent.tsx
 * @description 输入栏的加号按钮，唤起拍照、相册、文件三条选择入口。
 * 选择器产物归一为 PickedFile 后经 onFileSelected 进入附件映射，
 * 图片与文件的分流和体积数量的过滤由附件状态统一执行，本组件不做。
 */
import {
  ActionSheetIOS,
  Alert,
  Platform,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import React, { useCallback, useMemo } from 'react';
import {
  ImagePickerResponse,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Plus } from 'lucide-react-native';
import { useTheme, ColorScheme } from '../../theme/index.ts';
import { logger } from '../../lib/logger';
import type { PickedFile } from '../util/FileUtils.ts';

interface CustomAddFileComponentProps {
  onFileSelected: (files: PickedFile[]) => void;
}

export const CustomAddFileComponent: React.FC<CustomAddFileComponentProps> = ({
  onFileSelected,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  /**
   * 处理 image-picker 响应：权限被拒时弹提示引导，其余错误记日志。
   * - 避免 iPad 兼容模式等场景下静默失败，用户无任何反馈
   */
  const handlePickerResponse = useCallback(
    async (res: ImagePickerResponse, resource: string) => {
      if (res.errorCode) {
        if (res.errorCode === 'permission') {
          Alert.alert(
            'Permission Required',
            `Persona needs access to your ${resource} to continue. Please enable it in Settings.`
          );
        } else {
          logger.error(
            `[FilePicker] ${res.errorCode}:`,
            res.errorMessage ?? ''
          );
        }
        return;
      }
      const files = (res.assets ?? [])
        .filter((asset): asset is typeof asset & { uri: string } =>
          Boolean(asset.uri)
        )
        .map((asset) => ({
          uri: asset.uri,
          fileName: asset.fileName ?? `photo_${Date.now()}.jpeg`,
          fileSize: asset.fileSize ?? 0,
          mimeType: asset.type,
          width: asset.width,
          height: asset.height,
        }));
      if (files.length > 0) {
        onFileSelected(files);
      }
    },
    [onFileSelected]
  );

  /** 拍照，相册与相机都收纯图片，视频入口退役 */
  const handleCamera = () => {
    launchCamera({
      saveToPhotos: false,
      mediaType: 'photo',
      includeBase64: false,
      includeExtra: true,
      presentationStyle: 'fullScreen',
    })
      .then((res) => handlePickerResponse(res, 'camera'))
      .catch((err: unknown) => {
        logger.error('[FilePicker] camera failed:', err);
      });
  };

  /** 从相册选图片 */
  const handlePhotos = () => {
    launchImageLibrary({
      selectionLimit: 0,
      mediaType: 'photo',
      includeBase64: false,
      includeExtra: true,
      assetRepresentationMode: 'current',
      presentationStyle: 'fullScreen',
    })
      .then((res) => handlePickerResponse(res, 'photo library'))
      .catch((err: unknown) => {
        logger.error('[FilePicker] photo library failed:', err);
      });
  };

  /** 从文件系统选文件，copyToCacheDirectory 关闭保持 content uri 直传，避免大文件双重复制 */
  const handleChooseFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        type: ['*/*'],
        copyToCacheDirectory: false,
      });
      if (result.canceled) {
        return;
      }
      const files = (result.assets ?? [])
        .filter((asset) => asset.uri && asset.name)
        .map((asset) => ({
          uri: asset.uri,
          fileName: asset.name!,
          fileSize: asset.size ?? 0,
          mimeType: asset.mimeType,
        }));
      if (files.length > 0) {
        onFileSelected(files);
      }
    } catch (err: unknown) {
      logger.error('[FilePicker] selection failed:', err);
    }
  };

  /**
   * 弹出文件选择菜单：拍照 / 相册 / 文件。
   * iOS 用 ActionSheetIOS 底部弹出，Android 用 Alert 对话框。
   */
  const handlePress = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [
            'Take Camera',
            'Choose From Photos',
            'Choose From Files',
            'Cancel',
          ],
          cancelButtonIndex: 3,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            handleCamera();
          } else if (buttonIndex === 1) {
            handlePhotos();
          } else if (buttonIndex === 2) {
            handleChooseFiles();
          }
        }
      );
    } else {
      Alert.alert('', '', [
        { text: 'Take Camera', onPress: handleCamera },
        { text: 'Choose From Photos', onPress: handlePhotos },
        { text: 'Choose From Files', onPress: handleChooseFiles },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <TouchableOpacity
      style={styles.addButton}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Plus size={22} color={colors.textSecondary} />
    </TouchableOpacity>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    addButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
