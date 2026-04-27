import { IMessage } from 'react-native-gifted-chat';
import { User } from 'react-native-gifted-chat/lib/Models';

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
};

export enum ChatStatus {
  Init = 'Init',
  Running = 'Running',
  Complete = 'Complete',
}

export interface EventData {
  id?: number | string;
  url?: string;
  script?: string;
  data?: string;
  error?: string;
  code?: number;
  title?: string;
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

export enum FileType {
  document = 'document',
  image = 'image',
  video = 'video',
  unSupported = 'unSupported',
}

export type FileInfo = {
  fileName: string;
  url: string;
  videoUrl?: string;
  videoThumbnailUrl?: string;
  fileSize: number;
  format: string;
  type: FileType;
  width?: number;
  height?: number;
};

export type Usage = {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export interface ChatMessage extends IMessage {
  usage?: Usage;
  reasoning?: string;
  user: ChatUser;
  metrics?: Metrics;
  citations?: Citation[];
}

interface ChatUser extends User {}

export interface Metrics {
  latencyMs: string;
  speed: string;
}
