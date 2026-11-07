/**
 * @file FileUtils.ts
 * @description 聊天附件的工具集：
 * - 上限常量与图片 MIME 白名单，数量二十合计、单件二十兆，对齐服务端口径
 * - 选择器产物到附件草稿的进入映射，声明 MIME 命中白名单按图片收留，其余按文件收留，不读字节不嗅探
 * - 发送前的图片压缩判定，达标原样返回保 gif 动画，超限交给 compressor 按限值压回
 * - 展示预设与体积格式化，含九档类型徽章配色，文件卡渲染共用
 */
import RNFS from 'react-native-fs';
import { getImageMetaData, Image as Img } from 'react-native-compressor';
import {
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Presentation,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { FileInfo, FileType } from '../../types/Chat.ts';
import { MIME_BY_EXT } from '../../api/server-api.ts';
import { logger } from '../../lib/logger';

/** 图片附件的 MIME 白名单，命中走图片通道，其余一律视为文件 */
export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

/** 每条消息附件合计上限，图片与文件混算 */
export const MAX_ATTACHMENTS = 20;

/** 单个附件入口体积上限，超过不收并提示 */
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

/** 图片压缩判定的长边像素与体积字节阈值，达标原样上传 */
const IMAGE_MAX_EDGE = 2048;
const IMAGE_MAX_BYTES = 4.5 * 1024 * 1024;

/** 三条选择入口的产物公共形状，各选择器在调用侧归一 */
export interface PickedFile {
  uri: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  width?: number;
  height?: number;
}

/** 取小写扩展名，jpg 归一为 jpeg，无扩展名返回空串 */
export const extensionOf = (fileName: string): string => {
  if (!fileName.includes('.')) return '';
  const ext = fileName.split('.').pop() ?? '';
  return (ext === 'jpg' ? 'jpeg' : ext).toLowerCase();
};

/**
 * 单个选择器产物转附件草稿。
 * 声明 MIME 命中白名单按图片收留并保留宽高，其余按文件收留，不读字节不嗅探。
 */
export function intakeFile(picked: PickedFile): FileInfo {
  const isImage =
    !!picked.mimeType && IMAGE_MIME_TYPES.includes(picked.mimeType);
  return {
    id: uuidv4(),
    fileName: picked.fileName,
    url: picked.uri,
    fileSize: picked.fileSize,
    format: extensionOf(picked.fileName),
    type: isImage ? FileType.image : FileType.document,
    width:
      isImage && picked.width && picked.width > 0 ? picked.width : undefined,
    height:
      isImage && picked.height && picked.height > 0 ? picked.height : undefined,
    status: 'ready',
  };
}

/** 压缩判定的产物，地址与格式与宽高与体积随产物重取 */
export interface CompressedImage {
  uri: string;
  mimeType: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
}

/**
 * 发送前的图片压缩判定。
 * - 长边不超过 2048 像素且体积不超过 4.5MB 的原样返回，一个字节不动，gif 动画因此保留
 * - 超限图交给 compressor 按限值压回，格式与宽高与体积按压缩产物重取
 */
export async function compressImageIfNeeded(
  item: FileInfo
): Promise<CompressedImage> {
  const longEdge = Math.max(item.width ?? 0, item.height ?? 0);
  if (longEdge <= IMAGE_MAX_EDGE && item.fileSize <= IMAGE_MAX_BYTES) {
    return {
      uri: item.url,
      mimeType: MIME_BY_EXT[item.format] ?? 'image/jpeg',
      format: item.format,
      width: item.width,
      height: item.height,
      bytes: item.fileSize,
    };
  }
  const uri = await Img.compress(item.url, {
    maxWidth: IMAGE_MAX_EDGE,
    maxHeight: IMAGE_MAX_EDGE,
  });
  const meta = await getImageMetaData(uri);
  const stat = await RNFS.stat(uri);
  const format = extensionOf(`image.${meta.extension}`);
  logger.info(
    `[attachments] image compressed, name=${item.fileName} before=${item.fileSize} after=${stat.size} format=${format}`
  );
  return {
    uri,
    mimeType: MIME_BY_EXT[format] ?? 'image/jpeg',
    format,
    width: meta.ImageWidth,
    height: meta.ImageHeight,
    bytes: stat.size,
  };
}

/** 文件卡的展示预设，图标与类型标签与徽章配色按扩展名命中 */
export interface AttachmentPresentation {
  icon: ComponentType<{
    size?: number;
    color?: string;
    style?: { marginRight: number };
  }>;
  typeLabel: string;
  /** 徽章底色与图标色，文件类型装饰色不进主题令牌，作为预设数据沉淀 */
  iconBg: string;
  iconColor: string;
}

/** 预设条目在展示形状之上携带扩展名清单，配色换算自桌面端 Tailwind 色板配对 */
interface PresentationPreset extends AttachmentPresentation {
  extensions: string[];
}

const PRESENTATIONS: PresentationPreset[] = [
  {
    icon: FileText,
    typeLabel: 'PDF',
    iconBg: '#FEE2E2',
    iconColor: '#B91C1C',
    extensions: ['pdf'],
  },
  {
    icon: FileType2,
    typeLabel: 'WORD',
    iconBg: '#DBEAFE',
    iconColor: '#1D4ED8',
    extensions: ['doc', 'docx', 'rtf'],
  },
  {
    icon: FileSpreadsheet,
    typeLabel: 'EXCEL',
    iconBg: '#DCFCE7',
    iconColor: '#15803D',
    extensions: ['xls', 'xlsx', 'csv'],
  },
  {
    icon: Presentation,
    typeLabel: 'PPT',
    iconBg: '#FFEDD5',
    iconColor: '#C2410C',
    extensions: ['ppt', 'pptx'],
  },
  {
    icon: FileCode2,
    typeLabel: 'CODE',
    iconBg: '#E0E7FF',
    iconColor: '#4338CA',
    extensions: [
      'ts',
      'tsx',
      'js',
      'jsx',
      'py',
      'rs',
      'go',
      'java',
      'c',
      'cpp',
      'h',
      'cs',
      'rb',
      'sh',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'html',
      'css',
      'sql',
    ],
  },
  {
    icon: FileText,
    typeLabel: 'TEXT',
    iconBg: '#F1F5F9',
    iconColor: '#334155',
    extensions: ['md', 'txt', 'log', 'ini', 'cfg'],
  },
  {
    icon: FileArchive,
    typeLabel: 'ARCHIVE',
    iconBg: '#FEF3C7',
    iconColor: '#B45309',
    extensions: ['zip', 'tar', 'gz', '7z', 'rar'],
  },
  {
    icon: FileImage,
    typeLabel: 'IMAGE',
    iconBg: '#CFFAFE',
    iconColor: '#0E7490',
    extensions: ['png', 'jpeg', 'webp', 'gif', 'svg', 'bmp'],
  },
];

const FALLBACK_PRESENTATION: AttachmentPresentation = {
  icon: File,
  typeLabel: 'FILE',
  iconBg: '#F0F0F0',
  iconColor: '#666666',
};

/** 扩展名到预设的检索表，构建期一次展开 */
const presetByExtension = new Map<string, AttachmentPresentation>();
for (const preset of PRESENTATIONS) {
  for (const ext of preset.extensions) {
    presetByExtension.set(ext, preset);
  }
}

/** 按文件名取展示预设，扩展名未命中时回退通用文件档 */
export function getAttachmentPresentation(
  fileName: string
): AttachmentPresentation {
  return presetByExtension.get(extensionOf(fileName)) ?? FALLBACK_PRESENTATION;
}

/** 人类可读的附件体积，数值小于 10 保留一位小数否则取整 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(bytes, 0)}B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const text = size < 10 ? size.toFixed(1) : String(Math.round(size));
  return `${text}${units[unit]}`;
}
