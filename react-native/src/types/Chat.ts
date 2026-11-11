import { IMessage } from 'react-native-gifted-chat';
import { User } from 'react-native-gifted-chat/lib/Models';
import type { Thought } from './Thought';

export interface Citation {
  number: number; // 引用编号 [1], [2], [3]...
  title: string; // 链接标题
  url: string; // 链接地址
  excerpt?: string; // 简介/摘要
}

export type Chat = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  /** 会话未读标记，server 权威字段经镜像携带，点进会话上报清除 */
  hasUnread?: boolean;
};

export enum ChatStatus {
  Init = 'Init',
  Running = 'Running',
  Complete = 'Complete',
}

export type Model = {
  modelId: string;
  modelName: string;
  uniqueId?: string;
};

export enum PressMode {
  Click = 'Click',
  LongPress = 'LongPress',
}

export interface DropdownItem {
  label: string;
  value: string;
}

/** 附件的两档类型，视频不再特殊对待，视频文件按普通文件走文件分支 */
export enum FileType {
  document = 'document',
  image = 'image',
}

/** 草稿期上传状态，进消息后不再变化 */
export type AttachmentStatus = 'ready' | 'uploading' | 'uploaded' | 'error';

export type FileInfo = {
  /** 草稿内唯一标识，删除与重试的定位键 */
  id: string;
  fileName: string;
  /** 草稿期为本地 uri，历史解析后为带哈希的读取地址 */
  url: string;
  fileSize: number;
  /** 小写扩展名，jpg 归一为 jpeg */
  format: string;
  type: FileType;
  width?: number;
  height?: number;
  status?: AttachmentStatus;
  /** 上传落定的内容哈希 */
  hash?: string;
};

/** 纯文本内容块 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** 图片内容块，宽高由客户端草稿期读取随块携带，name 是原始文件名，历史块可能缺失 */
export interface ImageBlock {
  type: 'image';
  hash: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  name?: string;
}

/** 文件内容块，只携带定位与展示所需的最小字段 */
export interface FileBlock {
  type: 'file';
  hash: string;
  name: string;
  bytes: number;
}

/** 多模态消息的内容块联合，镜像服务端 ContentBlock 协议 */
export type ContentBlock = TextBlock | ImageBlock | FileBlock;

export type Usage = {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export interface ChatMessage extends IMessage {
  usage?: Usage;
  steps?: Thought[];
  user: ChatUser;
  metrics?: Metrics;
  citations?: Citation[];
  aborted?: boolean;
  /** 待注入插话标记，服务端缓冲取空后清除 */
  queued?: boolean;
  /** 关联服务端待注入缓冲条目的 id */
  pendingId?: string;
}

export type ChatUser = User;

export interface Metrics {
  latencyMs: string;
  speed: string;
}
