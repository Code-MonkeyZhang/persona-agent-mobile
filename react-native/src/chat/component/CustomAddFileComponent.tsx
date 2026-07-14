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
import { FileInfo, FileType } from '../../types/Chat.ts';
import {
  pick,
  types,
  DocumentPickerResponse,
} from 'react-native-document-picker';
import { saveFile } from '../util/FileUtils.ts';
import {
  createVideoThumbnail,
  getImageMetaData,
  getVideoMetaData,
  Image as Img,
} from 'react-native-compressor';
import { logger } from '../../lib/logger';
import { getTextModel } from '../../storage/StorageUtils.ts';
import { showInfo } from '../util/ToastUtils.ts';
import { useTheme, ColorScheme } from '../../theme/index.ts';
import { Plus } from 'lucide-react-native';
import i18n from '../../i18n/index.ts';

interface CustomAddFileComponentProps {
  onFileSelected: (files: FileInfo[]) => void;
}

export const CustomAddFileComponent: React.FC<CustomAddFileComponentProps> = ({
  onFileSelected,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  /** 处理 DocumentPicker 返回的文件：校验格式、压缩、保存 */
  const processFiles = useCallback(
    async (pickResults: DocumentPickerResponse[]): Promise<FileInfo[]> => {
      const files: FileInfo[] = [];
      await Promise.all(
        pickResults.map(async (pickResult) => {
          if (pickResult.name && pickResult.uri) {
            const fileName = getFileNameWithoutExtension(pickResult.name);
            const fileNameArr = pickResult.name.split('.');
            let format = fileNameArr[fileNameArr.length - 1].toLowerCase();
            const fileType = getFileType(format);
            if (fileType === FileType.unSupported) {
              showInfo(i18n.t('error.unsupportedFormat', { format }));
              return;
            }
            if (
              fileType === FileType.document &&
              (pickResult.size ?? 0) >= MAX_FILE_SIZE
            ) {
              showInfo(i18n.t('error.fileTooLarge', { name: pickResult.name }));
              return;
            }
            let localFileUrl: string | null;
            let width = 0;
            let height = 0;
            if (fileType === FileType.image) {
              pickResult.uri = decodeURI(pickResult.uri);
              if (format === 'png' || format === 'jpg' || format === 'jpeg') {
                pickResult.uri = await Img.compress(pickResult.uri);
                const metaData = await getImageMetaData(pickResult.uri);
                format = metaData.extension;
                width = metaData.ImageWidth;
                height = metaData.ImageHeight;
              }
              localFileUrl = await saveFile(pickResult.uri, pickResult.name);
            } else if (fileType === FileType.video) {
              localFileUrl = pickResult.uri;
            } else {
              localFileUrl = await saveFile(
                decodeURI(pickResult.uri),
                pickResult.name
              );
            }

            let thumbnailUrl;
            if (fileType === FileType.video) {
              if (Platform.OS === 'android') {
                localFileUrl = await saveFile(pickResult.uri, fileName);
                pickResult.uri = localFileUrl!;
              }
              const thumbnail = await createVideoThumbnail(pickResult.uri);
              thumbnailUrl =
                (await saveFile(thumbnail.path, fileName + '.jpeg')) ?? '';
              const metaData = await getVideoMetaData(pickResult.uri);
              width = metaData.width;
              height = metaData.height;
            }

            if (localFileUrl) {
              files.push({
                fileName: fileName,
                url: localFileUrl,
                videoThumbnailUrl: thumbnailUrl,
                fileSize: pickResult.size ?? 0,
                type: fileType,
                format: format.toLowerCase() === 'jpg' ? 'jpeg' : format,
                width: width,
                height: height,
              });
            }
          }
        }) ?? []
      );
      return files;
    },
    []
  );

  /** 拍照选文件 */
  const handleCamera = () => {
    launchCamera({
      saveToPhotos: false,
      mediaType: isVideoSupported() ? 'mixed' : 'photo',
      videoQuality: 'high',
      durationLimit: 30,
      includeBase64: false,
      includeExtra: true,
      presentationStyle: 'fullScreen',
    }).then(async (res) => {
      const files = await getFiles(res);
      if (files.length > 0) {
        onFileSelected(files);
      }
    });
  };

  /** 从相册选文件 */
  const handlePhotos = () => {
    launchImageLibrary({
      selectionLimit: 0,
      mediaType: isVideoSupported() ? 'mixed' : 'photo',
      includeBase64: false,
      includeExtra: true,
      assetRepresentationMode: 'current',
    }).then(async (res) => {
      const files = await getFiles(res);
      if (files.length > 0) {
        onFileSelected(files);
      }
    });
  };

  /** 从文件系统选文件 */
  const handleChooseFiles = async () => {
    try {
      const pickResults = await pick({
        allowMultiSelection: true,
        type: [types.allFiles],
      });
      const files = await processFiles(pickResults);
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

const MAX_FILE_SIZE = 4.5 * 1024 * 1024;
export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
export const VIDEO_FORMATS = ['mp4', 'mov', 'mkv', 'webm'];
export const EXTRA_DOCUMENT_FORMATS = [
  'json',
  'py',
  'ts',
  'tsx',
  'js',
  'kt',
  'java',
  'swift',
  'c',
  'm',
  'h',
  'sh',
  'cpp',
  'rs',
  'go',
  'class',
  'cs',
  'php',
  'rb',
  'dart',
  'sql',
  'css',
  'xml',
  'yaml',
  'yml',
];
export const DOCUMENT_FORMATS = [
  'pdf',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'html',
  'txt',
  'md',
  ...EXTRA_DOCUMENT_FORMATS,
];

export const getFileType = (format: string) => {
  if (isImageFormat(format)) {
    return FileType.image;
  } else if (isVideoFormat(format)) {
    return FileType.video;
  } else if (isDocumentFormat(format)) {
    return FileType.document;
  } else {
    return FileType.unSupported;
  }
};

export const isImageFormat = (format: string) => {
  return IMAGE_FORMATS.includes(format);
};

export const isVideoFormat = (format: string) => {
  return VIDEO_FORMATS.includes(format);
};

export const isDocumentFormat = (format: string) => {
  return DOCUMENT_FORMATS.includes(format);
};

const getFileNameWithoutExtension = (fileName: string) => {
  return fileName.substring(0, fileName.lastIndexOf('.')).trim();
};

export const isVideoSupported = (): boolean => {
  const textModelId = getTextModel().modelId;
  return textModelId.includes('nova');
};

const getFiles = async (res: ImagePickerResponse) => {
  const files: FileInfo[] = [];
  await Promise.all(
    res.assets?.map(async (media) => {
      if (media.fileName && media.uri) {
        const fileName = getFileNameWithoutExtension(media.fileName);
        const fileNameArr = media.fileName.split('.');
        let format = fileNameArr[fileNameArr.length - 1].toLowerCase();
        const fileType = getFileType(format);
        if (fileType === FileType.unSupported) {
          showInfo(i18n.t('error.unsupportedFormat', { format }));
          return;
        }
        let width = media.width;
        let height = media.height;
        if (format === 'png' || format === 'jpg' || format === 'jpeg') {
          media.uri = await Img.compress(media.uri);
          const metaData = await getImageMetaData(media.uri);
          format = metaData.extension;
          width = metaData.ImageWidth;
          height = metaData.ImageHeight;
        }
        let thumbnailUrl;
        if (fileType === FileType.video) {
          const thumbnail = await createVideoThumbnail(media.uri);
          thumbnailUrl =
            (await saveFile(thumbnail.path, fileName + '.jpeg')) ?? '';
        }
        let localFileUrl: string | null;
        if (fileType !== FileType.video) {
          localFileUrl = await saveFile(media.uri, media.fileName);
        } else {
          localFileUrl = media.uri;
        }

        if (localFileUrl) {
          files.push({
            fileName: fileName,
            url: localFileUrl,
            videoThumbnailUrl: thumbnailUrl,
            fileSize: media.fileSize ?? 0,
            type: fileType,
            format: format === 'jpg' ? 'jpeg' : format,
            width: width,
            height: height,
          });
        }
      }
    }) ?? []
  );
  return files;
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
