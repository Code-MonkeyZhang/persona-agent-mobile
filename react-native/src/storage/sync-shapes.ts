/**
 * @file storage/sync-shapes.ts
 * @description 同步链路的数据形状与纯函数，抄录自 persona-agent 仓的 @persona/shared。
 *   移动端是独立 git 仓，与 monorepo 无包共享机制，此文件承担镜像库的形状契约，
 *   抄录时点为 stage 10 施工加小手机偏好接入，来源文件 schema.ts、session.ts、
 *   changes.ts、session-view.ts、preview.ts、launcher.ts，服务端接口变化时需手工同步。
 *   附带镜像 Message 到本地 ServerChatMessage 的投影，镜像读路径与 HTTP 详情接口同形。
 */
import type { AgentInfo } from '../api/server-api.ts';

/** 模型配置，对齐 shared 的 ModelConfig */
export interface ModelConfig {
  provider: string;
  model: string;
}

/** 多模态消息的内容块 */
export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** 包含 system prompt 的系统消息 */
export interface SystemMessage {
  role: 'system';
  content: string;
  /** 轮次边界标志，仅出现在接口层与镜像读路径，落盘文件里不存在此形状 */
  turnEnd?: boolean;
}

export interface UserMessage {
  role: 'user';
  content: string | ContentBlock[];
}

/** 助手消息中的工具调用 */
export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
  toolResult?: {
    content: string;
    isError: boolean;
  };
}

/** 助手消息，包含可选的思考和工具调用 */
export interface AssistantMessage {
  role: 'assistant';
  content?: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  stopReason?: 'aborted';
}

/** 错误消息，持久化 API 调用失败等信息，占助手槽位注入模型上下文 */
export interface ErrorMessage {
  role: 'error';
  content: string;
}

/** Agent App 通知消息，存储层独立于 user 与 assistant，永不改写 */
export interface AppNotificationMessage {
  role: 'app_notification';
  source: string;
  content: string;
}

/** 运行时上下文注入消息，前端不渲染 */
export interface ContextMessage {
  role: 'context';
  source: 'runtime-context';
  content: string;
}

/** 消息联合，可选 seq 是服务端消息行号，镜像去重的基准 */
export type Message = (
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ErrorMessage
  | AppNotificationMessage
  | ContextMessage
) & { seq?: number };

/** 会话元信息，镜像库 sessions 表的 meta 载荷 */
export interface SessionMeta {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspacePath?: string;
  model: ModelConfig;
  /** 原始消息已压缩到的下标，undefined 与 0 表示尚未压缩 */
  summarizedUpTo?: number;
  /** 当前立绘表情名称，undefined 时前端 fallback 到 default */
  currentPose?: string;
  /** 最后一条真实消息的预览，镜像读路径现算 */
  lastMessage?: string;
}

/** 快照里的单条消息，seq 为消息行号 */
export interface SnapshotMessage {
  seq: number;
  message: Message;
  createdAt: number;
}

/** 快照里的单个会话，消息带行号与行时间戳 */
export interface SnapshotSession extends SessionMeta {
  turnEnds?: number[];
  messages: SnapshotMessage[];
}

/** 全量同步快照，latestSeq 为快照时刻变更流的最新序号 */
export interface SyncSnapshot {
  latestSeq: number;
  sessions: SnapshotSession[];
  /** 全部 Agent 清单，配置层的快照载荷，头像哈希随行 */
  agents: AgentInfo[];
  /** 小手机偏好节，行未写入时对应键缺席 */
  launcher?: LauncherSnapshot;
}

/** 变更事件的种类 */
export type ChangeKind =
  | 'message_appended'
  | 'session_created'
  | 'session_updated'
  | 'session_deleted'
  | 'turn_end'
  | 'agents_invalidated'
  | 'launcher_prefs_updated';

/**
 * 单条变更事件。
 * - message_appended 的 data 为 { seq, message }，携带完整消息体
 * - session_created 与 session_updated 的 data 为完整会话元信息
 * - session_deleted 的 data 为空对象，id 由 sessionId 字段承载
 * - turn_end 的 data 为 { turnEnds }，是边界的完整快照
 * - agents_invalidated 的 data 为空对象，sessionId 为 null，客户端整份重拉角色列表
 * - launcher_prefs_updated 的 data 为 LauncherPrefsChangeData，携带整份偏好文档
 */
export interface SessionChange {
  /** 全局递增序号，客户端以此判断自己追平到哪里 */
  seq: number;
  kind: ChangeKind;
  /** 事件归属的会话 */
  sessionId: string | null;
  /** 按 kind 不同的载荷 */
  data: unknown;
  createdAt: number;
}

/** 排列文档，稀疏数组元素是应用 id、槽位 id 或显式空位，抄录自 shared 的 launcher.ts */
export interface LauncherOrderDoc {
  appOrder: (string | null)[];
}

/** 自定义壁纸条目，文件按内容哈希寻址，深浅标记由服务端采样写入 */
export interface WallpaperCustom {
  id: string;
  hash: string;
  thumbHash: string;
  name?: string;
  dark: boolean;
}

/** 壁纸文档，currentId 兼存预设 id 与自定义 id，null 表示默认底 */
export interface WallpaperDoc {
  currentId: string | null;
  customs: WallpaperCustom[];
}

/** launcher_prefs 表的两行键名 */
export type LauncherPrefKey = 'appOrder' | 'wallpaper';

/** 单份偏好文档的信封，updatedAt 是服务端毫秒时间戳，last-write-wins 的裁决依据 */
export interface LauncherPrefEntry<T> {
  payload: T;
  updatedAt: number;
}

/** 全量快照的 launcher 节，行未写入时对应键缺席 */
export interface LauncherSnapshot {
  appOrder?: LauncherPrefEntry<LauncherOrderDoc>;
  wallpaper?: LauncherPrefEntry<WallpaperDoc>;
}

/** launcher_prefs_updated 变更的载荷，携带整份文档，客户端无需回读 */
export interface LauncherPrefsChangeData {
  key: LauncherPrefKey;
  payload: LauncherOrderDoc | WallpaperDoc;
  updatedAt: number;
}

/** 预览文本截断长度上界，UI 层自带 truncate 样式，此处只约束 payload 大小 */
const PREVIEW_MAX_LENGTH = 80;

/**
 * 把消息原文清洗为会话列表预览文本。
 * - 去除 HTML 标签，避免富文本标记进入单行预览
 * - trim 后按字符截断，超长部分直接舍弃
 */
export function buildPreviewText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, PREVIEW_MAX_LENGTH);
}

/**
 * 提取一条消息的纯文本，供预览使用。
 * - 仅认 user 与 assistant 角色，其余角色返回 undefined
 * - user 的 content 兼容纯字符串与内容块数组，数组取各块的 text 拼接
 * - assistant 纯工具步无 content 返回 undefined，追加时不更新预览
 */
export function messagePreviewText(message: Message): string | undefined {
  if (message.role === 'user') {
    const content = message.content as UserMessage['content'];
    if (typeof content === 'string') return content;
    return content
      .map((block) => block.text ?? '')
      .join('')
      .trim();
  }
  if (message.role === 'assistant' && message.content) {
    return message.content;
  }
  return undefined;
}

/**
 * 从消息序列尾部提取会话预览文本，跳过无可预览文本的消息。
 */
export function deriveSessionPreview(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messagePreviewText(messages[i]);
    if (text && text.trim()) return buildPreviewText(text);
  }
  return undefined;
}

/**
 * 按 turnEnds 把轮次边界条目混入消息副本，渲染层扫描到边界即结组。
 * - 边界条目借用 system 角色与 turnEnd 标志，消费方的 system 跳过规则自然兼容
 * - 重复下标会连插边界条目，空缓冲结组是空操作，无害
 */
export function mixTurnEnds(
  messages: Message[],
  turnEnds: number[] | undefined
): Message[] {
  if (!turnEnds?.length) return messages;
  const result: Message[] = [];
  let cursor = 0;
  for (const count of turnEnds) {
    result.push(...messages.slice(cursor, count));
    result.push({ role: 'system', content: '', turnEnd: true });
    cursor = count;
  }
  result.push(...messages.slice(cursor));
  return result;
}

/**
 * 镜像读路径的会话形状，messages 已混入轮次边界条目。
 */
export interface MirrorSession extends SessionMeta {
  messages: Message[];
}

/**
 * 把镜像的消息投影成本地 ServerChatMessage 形状，镜像读路径与 HTTP 详情接口同形。
 * user 的内容块数组展平为拼接文本，其余角色字段直接对上。
 */
export function toServerChatMessages(
  messages: Message[]
): import('../api/server-api.ts').ServerChatMessage[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      const content = message.content as UserMessage['content'];
      const text =
        typeof content === 'string'
          ? content
          : content
              .map((block) => block.text ?? '')
              .join('')
              .trim();
      return { role: 'user', content: text };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content,
        thinking: message.thinking,
        tool_calls: message.tool_calls,
      };
    }
    if (message.role === 'system') {
      return {
        role: 'system',
        content: message.content,
        turnEnd: message.turnEnd,
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}
