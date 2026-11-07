/**
 * @file CustomFileListComponent.tsx
 * @description 聊天附件的文件列表组件，有编辑与展示两种模式。
 *              编辑态是输入栏的横向草稿条，带删除按钮与发送期状态蒙层，上传中转圈、失败红卡点击重试。
 *              展示态是消息气泡内的附件区，单图原比例高度封顶、多图两列网格、文件卡白底彩徽章，
 *              图片经 CachedImage 走哈希缓存，大图查看先过同一缓存管线，文件卡点击下载后打开。
 */
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import { FileInfo, FileType, AttachmentStatus } from '../../types/Chat.ts';
import ImageView from 'react-native-image-viewing';
import { ImageSource } from 'react-native-image-viewing/dist/@types/index';
import FileViewer from 'react-native-file-viewer';
import { RotateCw } from 'lucide-react-native';
import CachedImage from '../../component/CachedImage.tsx';
import { imageCache } from '../../storage/image-cache-rn.ts';
import {
  formatFileSize,
  getAttachmentPresentation,
} from '../util/FileUtils.ts';
import { ColorScheme, useTheme, typography } from '../../theme/index.ts';
import { useTranslation } from 'react-i18next';
import { logger } from '../../lib/logger';

interface CustomFileProps {
  files: FileInfo[];
  /** 编辑态的草稿删除 */
  onRemoveFile?: (id: string) => void;
  /** 编辑态的失败单项重试 */
  onRetryFile?: (id: string) => void;
  mode?: DisplayMode;
  isHideFileList?: boolean;
}

/** 文件列表的显示模式：Edit 可增删文件，Display 仅展示 */
export enum DisplayMode {
  Edit = 'edit',
  Display = 'display',
}

/** 用系统默认应用打开本地文件 */
const openInFileViewer = (url: string) => {
  FileViewer.open(url)
    .then(() => {})
    .catch((error) => {
      logger.warn('[FileList] open file failed:', error);
    });
};

/**
 * 展示态文件卡的打开动作。
 * 本地地址直开，远端地址先下载进缓存目录再交给系统查看器。
 */
const openRemoteFile = async (file: FileInfo) => {
  if (!file.url.startsWith('http')) {
    openInFileViewer(file.url);
    return;
  }
  try {
    const dot = file.fileName.lastIndexOf('.');
    const ext = dot >= 0 ? file.fileName.substring(dot) : '';
    const target = `${RNFS.CachesDirectoryPath}/${file.hash ?? 'file'}${ext}`;
    await RNFS.downloadFile({ fromUrl: file.url, toFile: target }).promise;
    logger.info(
      `[messageList] attachment downloaded, name=${file.fileName} bytes=${file.fileSize}`
    );
    openInFileViewer(target);
  } catch (error) {
    logger.warn('[messageList] attachment download failed:', error);
  }
};

/** 发送期状态蒙层，uploading 转圈，error 点击重试，草稿缩略图与文件卡共用 */
const StatusMask = ({
  status,
  onRetry,
  retryLabel,
}: {
  status?: AttachmentStatus;
  onRetry: () => void;
  retryLabel: string;
}) => {
  if (status === 'uploading') {
    return (
      <View style={maskStyles.overlay}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  if (status === 'error') {
    return (
      <TouchableOpacity
        style={[maskStyles.overlay, maskStyles.error]}
        onPress={onRetry}
        accessibilityLabel={retryLabel}
      >
        <RotateCw size={16} color="#FFFFFF" />
      </TouchableOpacity>
    );
  }
  return null;
};

const maskStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    backgroundColor: 'rgba(255,68,68,0.7)',
  },
});

const { width: screenWidth } = Dimensions.get('window');

/** 展示态几何常量，dp 单位，形态口径取自双端 demo 的气泡附件区 */
const SINGLE_IMAGE_MAX_HEIGHT = 180;
const ATTACHMENT_MIN_WIDTH = 140;
const FALLBACK_IMAGE_SIZE = 140;
const GRID_GAP = 4;
const GRID_MAX_WIDTH = 240;
const FILE_CARD_MAX_WIDTH = 200;
/** 用户气泡正文的横向内边距合计，展示区宽度预算据此扣减 */
const BUBBLE_HORIZONTAL_PADDING = 32;

/** 展示态内容宽度预算，按屏幕四分之三减气泡内边距计算并以二百四十封顶 */
const displayBudget = () =>
  Math.min(GRID_MAX_WIDTH, (screenWidth * 3) / 4 - BUBBLE_HORIZONTAL_PADDING);

/**
 * 单图展示盒，按原始比例以高度一百八十封顶与宽度预算双向夹紧，宽高缺失时回退方图。
 */
const singleImageBox = (file: FileInfo): { width: number; height: number } => {
  const budget = displayBudget();
  if (!file.width || !file.height) {
    const side = Math.min(FALLBACK_IMAGE_SIZE, budget);
    return { width: side, height: side };
  }
  const ratio = file.width / file.height;
  let height = Math.min(SINGLE_IMAGE_MAX_HEIGHT, file.height);
  let width = height * ratio;
  if (width > budget) {
    width = budget;
    height = width / ratio;
  }
  return { width, height };
};

export const CustomFileListComponent: React.FC<CustomFileProps> = ({
  files,
  onRemoveFile,
  onRetryFile,
  mode = DisplayMode.Edit,
  isHideFileList = false,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  /** 图片全屏预览是否可见 */
  const [visible, setIsVisible] = useState(false);
  /** 当前预览的图片索引 */
  const [index, setIndex] = useState<number>(0);
  /** 全屏预览用的图片 URL 列表 */
  const [imageUrls, setImageUrls] = useState<ImageSource[]>([]);

  const scrollViewRef = useRef<ScrollView>(null);

  /** 编辑模式下文件列表变化时自动滚动到末尾 */
  React.useEffect(() => {
    if (scrollViewRef.current && mode !== DisplayMode.Display) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [files, mode]);

  /**
   * 打开全屏大图，预览范围为列表内全部图片。
   * 每张图先过缓存管线，命中交给查看器本地路径零网络，未命中下载校验落盘
   * 后打开，地址无 h 参数回退原地址，与 CachedImage 的远端直显同姿态。
   */
  const openImageViewer = async (file: FileInfo) => {
    const images = files.filter((item) => item.type === FileType.image);
    const resolved = await Promise.all(
      images.map(async (item) => {
        const localPath = await imageCache.resolve(item.url);
        return localPath ? `file://${localPath}` : item.url;
      })
    );
    logger.info(
      `[messageList] viewer resolved, total=${resolved.length} local=${
        resolved.filter((uri) => uri.startsWith('file://')).length
      }`
    );
    setImageUrls(resolved.map((uri) => ({ uri })));
    setIndex(images.findIndex((item) => item.id === file.id));
    setIsVisible(true);
  };

  /**
   * 编辑态的单个草稿卡。
   * 图片用本地 uri 预览，文件卡展示名称与类型行，两者都带删除按钮与状态蒙层。
   */
  const renderDraftItem = (file: FileInfo) => {
    const isImage = file.type === FileType.image;
    const presentation = getAttachmentPresentation(file.fileName);
    const PresentationIcon = presentation.icon;
    return (
      <View
        key={file.id}
        style={{
          ...styles.fileItem,
          ...(!isImage && {
            width: 158,
          }),
        }}
      >
        {file.status !== 'uploading' && (
          <TouchableOpacity
            style={styles.deleteTouchable}
            onPress={() => onRemoveFile?.(file.id)}
          >
            <View style={styles.deleteLayout}>
              <Text style={styles.deleteText}>×</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => {
            if (isImage) {
              openImageViewer(file);
            } else {
              openInFileViewer(file.url);
            }
          }}
        >
          {isImage ? (
            <View style={styles.thumbnailContainer}>
              <Image
                source={{ uri: file.url }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
              <StatusMask
                status={file.status}
                onRetry={() => onRetryFile?.(file.id)}
                retryLabel={t('chat.retryUpload')}
              />
            </View>
          ) : (
            <View style={styles.filePreview}>
              <Text numberOfLines={2} style={styles.fileName}>
                {file.fileName}
              </Text>
              <View style={styles.formatContainer}>
                <PresentationIcon
                  size={19}
                  color={colors.textSecondary}
                  style={styles.formatIcon}
                />
                <Text style={styles.fileFormat}>
                  {`${presentation.typeLabel} · ${formatFileSize(
                    file.fileSize
                  )}`}
                </Text>
              </View>
              <StatusMask
                status={file.status}
                onRetry={() => onRetryFile?.(file.id)}
                retryLabel={t('chat.retryUpload')}
              />
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  /**
   * 展示态的单张图片，经 CachedImage 走哈希缓存，盒尺寸由调用方按单图或网格档位给出。
   */
  const renderDisplayImage = (
    file: FileInfo,
    box: { width: number; height: number }
  ) => (
    <TouchableOpacity
      key={file.id}
      activeOpacity={0.8}
      onPress={() => openImageViewer(file)}
    >
      <CachedImage
        source={file.url}
        style={[styles.displayImage, box]}
        resizeMode="cover"
      />
    </TouchableOpacity>
  );

  /**
   * 展示态附件区，图片组在上文件卡在下。
   * 单图原比例封顶高度，多图两列方格网格，文件卡点击下载后交给系统查看器。
   */
  const renderDisplayStack = () => {
    const images = files.filter((file) => file.type === FileType.image);
    const docs = files.filter((file) => file.type !== FileType.image);
    const cellSide = Math.floor((displayBudget() - GRID_GAP) / 2);
    return (
      <View style={styles.displayStack}>
        {images.length === 1
          ? renderDisplayImage(images[0], singleImageBox(images[0]))
          : images.length > 1 && (
              <View style={styles.imageGrid}>
                {images.map((image) =>
                  renderDisplayImage(image, {
                    width: cellSide,
                    height: cellSide,
                  })
                )}
              </View>
            )}
        {docs.map((file) => {
          const presentation = getAttachmentPresentation(file.fileName);
          const PresentationIcon = presentation.icon;
          return (
            <TouchableOpacity
              key={file.id}
              activeOpacity={0.8}
              style={styles.fileCard}
              onPress={() => openRemoteFile(file)}
              accessibilityLabel={t('chat.downloadFile')}
            >
              <View
                style={[
                  styles.fileBadge,
                  { backgroundColor: presentation.iconBg },
                ]}
              >
                <PresentationIcon size={16} color={presentation.iconColor} />
              </View>
              <View style={styles.fileCardText}>
                <Text numberOfLines={1} style={styles.fileCardName}>
                  {file.fileName}
                </Text>
                <Text style={styles.fileCardMeta}>
                  {`${presentation.typeLabel} · ${formatFileSize(
                    file.fileSize
                  )}`}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  /** 全屏图片预览组件，两种模式的渲染路径共用 */
  const imageViewer = (
    <ImageView
      images={imageUrls}
      imageIndex={index}
      visible={visible}
      onRequestClose={() => setIsVisible(false)}
    />
  );

  const styles = getStyles(colors);

  if (mode === DisplayMode.Display) {
    return (
      <>
        {renderDisplayStack()}
        {imageViewer}
      </>
    );
  }

  return (
    <>
      <ScrollView
        horizontal
        ref={scrollViewRef}
        contentContainerStyle={styles.containerStyle}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{
          ...styles.scrollView,
          ...(files.length === 0 &&
            isHideFileList && {
              opacity: 0,
              position: 'absolute',
              height: 0,
              overflow: 'hidden',
            }),
        }}
      >
        {files.map((file) => renderDraftItem(file))}
      </ScrollView>
      {imageViewer}
    </>
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
    /** 展示态附件区容器，最小宽承托小卡片，条目间距六 */
    displayStack: {
      minWidth: ATTACHMENT_MIN_WIDTH,
      gap: 6,
    },
    /** 多图两列网格容器 */
    imageGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: GRID_GAP,
    },
    /** 展示态图片圆角 */
    displayImage: {
      borderRadius: 8,
    },
    /** 展示态文件卡，白底横排，彩徽章加文件名与类型体积行 */
    fileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      maxWidth: FILE_CARD_MAX_WIDTH,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderLight,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    /** 文件卡左侧的类型徽章槽 */
    fileBadge: {
      width: 28,
      height: 28,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** 文件卡右侧文字列，收缩让文件名截断 */
    fileCardText: {
      flexShrink: 1,
    },
    /** 文件卡文件名，caption 档 */
    fileCardName: {
      ...typography.caption,
      color: colors.textDarkGray,
    },
    /** 文件卡类型与体积行，micro 档 */
    fileCardMeta: {
      ...typography.micro,
      color: colors.textTertiary,
      marginTop: 1,
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
      width: 25,
      height: 25,
      backgroundColor: colors.overlay,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteText: {
      color: colors.primaryForeground,
      ...typography.micro,
      marginTop: -1.5,
      marginRight: -0.5,
      fontWeight: 'normal',
    },
    /** 图片缩略图容器 */
    thumbnailContainer: {
      position: 'relative',
      width: '100%',
      height: '100%',
    },
    thumbnail: {
      width: '100%',
      height: '100%',
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
      ...typography.body,
      color: colors.text,
      paddingRight: 12,
    },
    fileFormat: {
      ...typography.body,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
