/**
 * @file CustomFileListComponent.tsx
 * @description 聊天附件文件列表组件，支持图片预览、视频压缩、文档查看、删除附件等操作。
 *              有编辑（Edit）和展示（Display）两种模式，分别用于输入栏和消息气泡中。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FileInfo, FileType } from '../../types/Chat.ts';
import ImageView from 'react-native-image-viewing';
import { ImageSource } from 'react-native-image-viewing/dist/@types/index';
import Share from 'react-native-share';
import FileViewer from 'react-native-file-viewer';
import { getFullFileUrl, saveFile } from '../util/FileUtils.ts';
import { getVideoMetaData, Video } from 'react-native-compressor';
import * as Progress from 'react-native-progress';
import { showInfo } from '../util/ToastUtils.ts';
import { ColorScheme, useTheme } from '../../theme/index.ts';
import { logger } from '../../lib/logger';
import { FileText, Play } from 'lucide-react-native';

interface CustomFileProps {
  /** 当前选中的文件列表 */
  files: FileInfo[];
  /** 文件列表变化时的回调（新增或删除文件时触发） */
  onFileUpdated?: (files: FileInfo[], isUpdate?: boolean) => void;
  /** 显示模式：Edit 显示删除按钮和添加按钮，Display 只展示缩略图 */
  mode?: DisplayMode;
  /** 为 true 时隐藏文件列表（但仍占位接收粘贴事件） */
  isHideFileList?: boolean;
}

/** 文件列表的显示模式：Edit 可增删文件，Display 仅展示 */
export enum DisplayMode {
  Edit = 'edit',
  Display = 'display',
}

/** 视频文件大小上限（MB），超过此大小会自动移除 */
const MAX_VIDEO_SIZE = 8;

/**
 * 用系统默认应用打开文件（文档、视频等）。
 * @param url 本地文件路径
 */
const openInFileViewer = (url: string) => {
  FileViewer.open(url)
    .then(() => {})
    .catch((error) => {
      logger.warn('[FileList] open file failed:', error);
    });
};

/** 视频压缩时显示在缩略图中央的圆形进度条 */
const CircularProgress = ({
  progress,
  colors,
}: {
  progress: number;
  colors: ColorScheme;
}) => {
  const styles = getStyles(colors);
  return (
    <View style={styles.progressContainer}>
      <Progress.Pie
        size={32}
        color="rgba(180, 180, 180, 1)"
        borderColor="rgba(180, 180, 180, 1)"
        progress={progress}
      />
    </View>
  );
};

export const CustomFileListComponent: React.FC<CustomFileProps> = ({
  files,
  onFileUpdated,
  mode = DisplayMode.Edit,
  isHideFileList = false,
}) => {
  const { colors } = useTheme();
  /** 图片全屏预览是否可见 */
  const [visible, setIsVisible] = useState(false);
  /** 当前预览的图片索引 */
  const [index, setIndex] = useState<number>(0);
  /** 全屏预览用的图片 URL 列表 */
  const [imageUrls, setImageUrls] = useState<ImageSource[]>([]);

  const scrollViewRef = useRef<ScrollView>(null);
  /** 当前视频压缩进度（0~1） */
  const [compressionProgress, setCompressionProgress] = useState<number>(0);
  /** 正在压缩的视频文件 URL，防止重复压缩 */
  const compressingFiles = useRef<string>('');
  /** files 的 ref 副本，供异步回调中读取 */
  const filesRef = useRef(files);
  /** 是否正在压缩中，防止并发压缩多个视频 */
  const isCompressing = useRef(false);

  /** 文件列表变化时同步 ref，并在编辑模式下自动滚动到末尾 */
  useEffect(() => {
    filesRef.current = files;
    if (scrollViewRef.current && mode !== DisplayMode.Display) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [files, mode]);

  /**
   * 遍历文件列表，对未压缩的视频逐个执行压缩。
   * 压缩后检查大小，超限则移除并提示，否则保存本地路径并更新文件列表。
   */
  const handleCompression = useCallback(async () => {
    for (const file of filesRef.current) {
      if (
        !isCompressing.current &&
        file.type === FileType.video &&
        !file.videoUrl &&
        compressingFiles.current !== file.url
      ) {
        compressingFiles.current = file.url;
        try {
          isCompressing.current = true;
          const uri = await Video.compress(
            file.url,
            { progressDivider: 1, maxSize: 960 },
            (progress) => {
              setCompressionProgress(progress);
            }
          );
          const metaData = await getVideoMetaData(uri);
          isCompressing.current = false;
          compressingFiles.current = '';
          const currentSize = metaData.size / 1024 / 1024;
          if (currentSize < MAX_VIDEO_SIZE) {
            // 压缩后大小合格，保存到本地并更新文件的 videoUrl
            const localFileUrl = await saveFile(
              uri,
              file.fileName + '.' + metaData.extension
            );
            if (localFileUrl) {
              const updatedFiles = filesRef.current.map((f) =>
                f.url === file.url
                  ? { ...f, videoUrl: localFileUrl, format: metaData.extension }
                  : f
              );
              onFileUpdated!(updatedFiles, true);
            }
          } else {
            // 视频超过大小限制，从列表中移除并提示用户
            const newFiles = filesRef.current.filter((f) => f.url !== file.url);
            onFileUpdated!(newFiles, true);
            showInfo(
              `Video too large: ${currentSize.toFixed(
                1
              )}MB (max ${MAX_VIDEO_SIZE}MB)`
            );
          }
        } catch (error) {
          showInfo('Video process failed');
          compressingFiles.current = '';
          isCompressing.current = false;
          // 压缩失败，移除该视频并提示
          const newFiles = filesRef.current.filter((f) => f.url !== file.url);
          onFileUpdated!(newFiles, true);
        }
      }
    }
  }, [onFileUpdated]);

  /** 文件列表变化时触发视频压缩检查 */
  useEffect(() => {
    const checkAndCompressVideos = async () => {
      await handleCompression();
    };
    checkAndCompressVideos().then();
  }, [files, handleCompression]);

  /**
   * 渲染单个文件卡片：根据文件类型显示图片缩略图、视频缩略图（带播放图标/压缩进度）或文档卡片。
   * 点击可预览/打开文件，长按可分享文件，编辑模式下显示删除按钮。
   * @param file 文件信息
   * @param fileIndex 文件在列表中的索引
   */
  const renderFileItem = (file: FileInfo, fileIndex: number) => {
    const isImage = file.type === FileType.image;
    const isDocument = file.type === FileType.document;
    const isVideo = file.type === FileType.video;
    const fullFileUrl =
      isVideo && !file.videoUrl
        ? file.url
        : getFullFileUrl(file.videoUrl || file.url);
    const itemKey = `file-${fileIndex}-${file.url}`;

    const isFileCompressing = compressingFiles.current === file.url;
    let ratio = 1;
    if (file.width && file.height) {
      ratio = file.width / file.height;
      ratio = ratio < 1 ? 1 : ratio;
    }
    const isHideDelete = file.type === FileType.video && !file.videoUrl;
    const isShowDelete = mode === DisplayMode.Edit && !isHideDelete;
    return (
      <View
        key={itemKey}
        style={{
          ...styles.fileItem,
          ...(isDocument && {
            width: 158,
          }),
          ...(isVideo && {
            width: 72 * ratio,
          }),
        }}
      >
        {isShowDelete && (
          <TouchableOpacity
            style={styles.deleteTouchable}
            onPress={() => {
              const newFiles = files.filter((f) => f.url !== file.url);
              onFileUpdated!(newFiles, true);
            }}
          >
            <View style={styles.deleteLayout}>
              <Text style={styles.deleteText}>×</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onLongPress={() => {
            try {
              const options = {
                type: 'text/plain',
                url: fullFileUrl,
                showAppsToView: true,
              };
              Share.open(options).then();
            } catch (error) {
              logger.warn('[FileList] Error opening file:', error);
            }
          }}
          onPress={() => {
            if (isVideo && isFileCompressing) {
              return;
            }
            if (
              file.type === FileType.document ||
              file.type === FileType.video
            ) {
              openInFileViewer(fullFileUrl);
            } else {
              const images = files
                .filter((item) => item.type === FileType.image)
                .map((item) => ({ uri: getFullFileUrl(item.url) }));
              const currentIndex = images.findIndex(
                (img) => img.uri === fullFileUrl
              );
              setImageUrls(images);
              setIndex(currentIndex);
              setIsVisible(true);
            }
          }}
        >
          {isImage || isVideo ? (
            <View style={styles.thumbnailContainer}>
              <Image
                source={{
                  uri: isVideo
                    ? getFullFileUrl(file.videoThumbnailUrl!)
                    : fullFileUrl,
                }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
              {isVideo && !isFileCompressing && (
                <View style={styles.playIcon}>
                  <Play size={32} color="white" />
                </View>
              )}
              {isVideo && isFileCompressing && (
                <CircularProgress
                  progress={compressionProgress}
                  colors={colors}
                />
              )}
            </View>
          ) : (
            <View style={styles.filePreview}>
              <Text numberOfLines={2} style={styles.fileName}>
                {file.fileName}
              </Text>
              <View style={styles.formatContainer}>
                <FileText
                  size={16}
                  color={colors.textSecondary}
                  style={styles.formatIcon}
                />
                <Text style={styles.fileFormat}>
                  {file.format.toUpperCase()}
                </Text>
              </View>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const styles = getStyles(colors);

  return (
    <ScrollView
      horizontal
      ref={scrollViewRef}
      contentContainerStyle={{
        ...styles.containerStyle,
        ...(mode === DisplayMode.Display && {
          paddingHorizontal: 0,
          width: files.length > 2 ? undefined : '100%',
          justifyContent: 'flex-end',
        }),
      }}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={{
        ...styles.scrollView,
        ...(mode === DisplayMode.Display && {
          marginLeft: 0,
          paddingTop: 4,
        }),
        // 无文件且需要隐藏时，将 ScrollView 缩为 0 高度但仍保留，用于接收 Command+V 粘贴文件事件
        ...(files.length === 0 &&
          isHideFileList && {
            opacity: 0,
            position: 'absolute',
            height: 0,
            overflow: 'hidden',
          }),
      }}
    >
      {files.map((file, fileIndex) => renderFileItem(file, fileIndex))}

      {/* 全屏图片预览组件 */}
      <ImageView
        images={imageUrls}
        imageIndex={index}
        visible={visible}
        onRequestClose={() => setIsVisible(false)}
      />
    </ScrollView>
  );
};

/** 文件列表样式工厂，根据当前主题色生成各组件样式 */
const getStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    /** 横向滚动容器 */
    scrollView: {
      paddingVertical: 8,
      backgroundColor: colors.fileListBackground,
    },
    /** ScrollView 内容容器，控制水平内边距 */
    containerStyle: {
      paddingHorizontal: 12,
    },
    /** 单个文件卡片的固定尺寸容器 */
    fileItem: {
      width: 72,
      height: 72,
      marginRight: 8,
      borderRadius: 8,
      overflow: 'hidden',
      position: 'relative',
    },
    /** 删除按钮的触摸区域 */
    deleteTouchable: {
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 1,
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** 删除按钮圆形背景 */
    deleteLayout: {
      width: 20,
      height: 20,
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteText: {
      color: '#fff',
      fontSize: 16,
      marginTop: -1.5,
      marginRight: -0.5,
      fontWeight: 'normal',
    },
    /** 图片/视频缩略图容器 */
    thumbnailContainer: {
      position: 'relative',
      width: '100%',
      height: '100%',
    },
    thumbnail: {
      width: '100%',
      height: '100%',
    },
    /** 视频缩略图上的播放按钮图标 */
    playIcon: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      marginTop: -16,
      marginLeft: -16,
    },
    /** 文档文件的预览卡片（显示文件名 + 格式图标） */
    filePreview: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.fileItemBorder,
      borderRadius: 8,
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      padding: 8,
    },
    /** 格式图标 + 文字容器 */
    formatContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    formatIcon: {
      marginRight: 4,
    },
    fileName: {
      fontSize: 12,
      color: colors.text,
      paddingRight: 12,
    },
    fileFormat: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    /** 压缩进度条的绝对定位容器 */
    progressContainer: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      marginTop: -16,
      marginLeft: -16,
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
