/**
 * @file FileUtils.ts
 * @description 聊天附件的文件处理工具集：
 * - 保存用户选中的文件到 App 存储目录（自动处理重名避免覆盖）
 * - 读取文件内容转成文本格式，用于发送给 AI 分析
 * - 统一处理 iPhone 和 Android 的文件路径差异
 * - 限制附件数量（图片 ≤20、文档 ≤5），超出自动截断
 * - 检查视频是否压缩完毕，未完成则不允许发送
 * - 用户只发文件没打字时，自动生成描述如 "Summarize these 2 images and 1 doc"
 */
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { FileInfo, FileType } from '../../types/Chat.ts';
import { getTextModel } from '../../storage/StorageUtils.ts';
import { logger } from '../../lib/logger';

/**
 * 将源文件复制到应用沙箱的 files/ 目录下。
 * 如果目标路径已存在同名文件，自动在文件名后追加 (1), (2) 等编号避免覆盖。
 * @param sourceUrl 源文件 URI（可以是 content://、file:// 等）
 * @param fileName 目标文件名（含扩展名）
 * @returns 保存后的本地路径，失败时返回 null
 */
export const saveFile = async (sourceUrl: string, fileName: string) => {
  try {
    const filesDir = `${RNFS.DocumentDirectoryPath}/files`;
    const filesDirExists = await RNFS.exists(filesDir);
    if (!filesDirExists) {
      await RNFS.mkdir(filesDir);
    }
    const uniqueFileName = await getUniqueFileName(filesDir, fileName);
    const destinationPath = `${filesDir}/${uniqueFileName}`;
    await RNFS.copyFile(sourceUrl, destinationPath);
    return Platform.OS === 'android'
      ? `file://${destinationPath}`
      : `files/${uniqueFileName}`;
  } catch (error) {
    logger.warn('Error saving file:', error);
  }
  return null;
};

/** 读取文件内容为 base64 编码字符串 */
export const getFileBytes = async (fileUrl: string) => {
  try {
    const fullFileUrl = getFullFileUrl(fileUrl);
    return await RNFS.readFile(fullFileUrl, 'base64');
  } catch (error) {
    logger.warn('Error reading image file:', fileUrl, error);
    throw error;
  }
};

/** 读取文本文件内容为 utf8 字符串 */
export const getFileTextContent = async (fileUrl: string): Promise<string> => {
  try {
    const fullFileUrl = getFullFileUrl(fileUrl);
    return await RNFS.readFile(fullFileUrl, 'utf8');
  } catch (error) {
    logger.warn('Error reading text file:', fileUrl, error);
    throw error;
  }
};

/**
 * 生成不重复的文件名。如果目标目录已存在同名文件，
 * 在文件名后追加 (1), (2) 等编号直到找到一个不存在的名称。
 */
const getUniqueFileName = async (
  basePath: string,
  originalFileName: string
): Promise<string> => {
  const lastDotIndex = originalFileName.lastIndexOf('.');
  const nameWithoutExt = originalFileName.substring(0, lastDotIndex);
  const extension = originalFileName.substring(lastDotIndex);

  let counter = 0;
  let finalFileName = originalFileName;
  let finalPath = `${basePath}/${finalFileName}`;

  while (await RNFS.exists(finalPath)) {
    counter++;
    finalFileName = `${nameWithoutExt}(${counter})${extension}`;
    finalPath = `${basePath}/${finalFileName}`;
  }
  return finalFileName;
};

/**
 * 将相对文件路径转换为绝对路径。
 * - Android：直接返回原始路径（已是 file:// 绝对路径）
 * - iOS "files/" 前缀：DocumentDirectoryPath 下的相对路径，拼接完整路径
 * - iOS 其他：取文件名部分拼接到 DocumentDirectoryPath/files/ 下
 */
export const getFullFileUrl = (url: string) => {
  if (Platform.OS === 'android') {
    return url;
  } else if (url.startsWith('files/')) {
    return `${RNFS.DocumentDirectoryPath}/${url}`;
  } else {
    return (
      RNFS.DocumentDirectoryPath +
      '/files' +
      url.substring(url.lastIndexOf('/'))
    );
  }
};

/** 图片数量上限 */
const MAX_IMAGES = 20;
/** 文档数量上限 */
const MAX_DOCUMENTS = 5;
/** Nova 模型文件总数上限 */
const MAX_NOVA_FILES = 5;
/** Nova 模型视频数量上限 */
const MAX_NOVA_VIDEOS = 1;

/**
 * 检查新增文件是否超过数量限制，超出的部分会被截断并弹出提示。
 * Nova 模型有独立的限制规则（总文件数 ≤ 5，视频数 ≤ 1）。
 * @param prevFiles 已选文件列表
 * @param newFiles 新增文件列表
 * @returns 合并后的文件列表（超出限制的已截断）
 */
export const checkFileNumberLimit = (
  prevFiles: FileInfo[],
  newFiles: FileInfo[]
) => {
  const existingImages = prevFiles.filter(
    (file) => file.type === FileType.image
  );
  const existingDocs = prevFiles.filter(
    (file) => file.type === FileType.document
  );
  const newImages = newFiles.filter((file) => file.type === FileType.image);
  const newDocs = newFiles.filter((file) => file.type === FileType.document);

  const totalImages = existingImages.length + newImages.length;
  const totalDocs = existingDocs.length + newDocs.length;

  let processedNewImages = newImages;
  let processedNewDocs = newDocs;

  if (isNova()) {
    if (prevFiles.length >= MAX_NOVA_FILES) {
      return prevFiles;
    }
    const existingVideos = prevFiles.filter(
      (file) => file.type === FileType.video
    ).length;
    const newVideos = newFiles.filter((file) => file.type === FileType.video);

    const filteredNewFiles =
      existingVideos >= MAX_NOVA_VIDEOS
        ? newFiles.filter((file) => file.type !== FileType.video)
        : newFiles.filter(
            (file) =>
              file.type !== FileType.video ||
              newVideos.indexOf(file) < MAX_NOVA_VIDEOS - existingVideos
          );

    return [...prevFiles, ...filteredNewFiles].slice(0, MAX_NOVA_FILES);
  }

  if (totalImages > MAX_IMAGES) {
    const remainingSlots = Math.max(0, MAX_IMAGES - existingImages.length);
    processedNewImages = newImages.slice(0, remainingSlots);
  }

  if (totalDocs > MAX_DOCUMENTS) {
    const remainingSlots = Math.max(0, MAX_DOCUMENTS - existingDocs.length);
    processedNewDocs = newDocs.slice(0, remainingSlots);
  }

  return [...prevFiles, ...processedNewImages, ...processedNewDocs];
};

/** 判断当前模型是否为 Nova 系列（有独立的文件限制规则） */
const isNova = (): boolean => {
  const textModelId = getTextModel().modelId;
  return textModelId.includes('nova-pro') || textModelId.includes('nova-lite');
};

/**
 * 检查所有视频文件是否已压缩完成。
 * 视频文件在压缩完成前 videoUrl 为 undefined，压缩后会被设置为本地路径。
 * @returns true = 所有文件就绪可以发送
 */
export const isAllFileReady = (files: FileInfo[]) => {
  const videos = files.filter((file) => file.type === FileType.video);
  if (videos.length > 0) {
    return videos.filter((video) => video.videoUrl === undefined).length === 0;
  } else {
    return true;
  }
};

/**
 * 根据附件文件列表生成摘要文本，作为用户消息的占位内容。
 * 例如："Summarize this"（单文件）或 "Summarize these image and 2 docs"（多文件）
 */
export const getFileTypeSummary = (files: FileInfo[]) => {
  if (files.length === 1) {
    return 'Summarize this';
  }

  const imgCount = files.filter((file) => file.type === FileType.image).length;
  const docCount = files.filter(
    (file) => file.type === FileType.document
  ).length;
  const videoCount = files.filter(
    (file) => file.type === FileType.video
  ).length;

  const types = [
    imgCount && `${imgCount > 1 ? 'images' : 'image'}`,
    docCount && `${docCount > 1 ? 'docs' : 'doc'}`,
    videoCount && `${videoCount > 1 ? 'videos' : 'video'}`,
  ].filter(Boolean);

  return `Summarize these ${types.join(' and ')}`;
};
