/**
 * @file server-api.ts
 * @description Agent Server 的客户端封装，提供 HTTP 请求（获取 Agent/会话列表等）
 *              和 WebSocket 连接（流式接收 AI 回复）两种通信方式。
 */
import uuid from 'uuid';
import type { ChatMessage } from '../types/Chat.ts';
import type { Thought } from '../types/Thought';
import { stripLastTextThought } from '../chat/util/thought-utils';
import { logger } from '../lib/logger';

/** 日志标签前缀 */
const TAG = '[ServerApi]';

/** AI 消息的用户 ID，用于 GiftedChat 区分用户和 AI */
const BOT_ID = 2;

/** step_complete 消息中的工具调用项 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** step_complete 消息中的工具执行结果项 */
export interface WsToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
  success: boolean;
}

/** speak_error 事件的原因枚举（与服务端 chat-service 的四种失败对齐） */
export type SpeakErrorReason =
  | 'no_api_key'
  | 'no_voice_id'
  | 'no_content'
  | 'voice_not_found';

/** 模型配置（对齐 @persona/shared 的 ModelConfig） */
interface ModelConfig {
  provider: string;
  model: string;
}

/** Agent Server 通过 WebSocket 下发的所有消息类型 */
export type ServerMessage =
  | { type: 'connected'; clientId: string }
  | { type: 'subscribed'; sessionId: string }
  | {
      type: 'step_complete';
      sessionId: string;
      stepIndex: number;
      content?: string;
      thinking?: string;
      /** 工具调用结果列表，用于在陪伴模式中响应 show_pose 等工具调用 */
      toolCalls?: ToolCall[];
      /** 工具执行结果列表，可用于展示工具是否成功 */
      toolResults?: WsToolResult[];
    }
  | { type: 'complete'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'title_updated'; sessionId: string; title: string }
  | {
      /** 服务端文本处理完成，移动端可直接用于 TTS 合成 */
      type: 'speak_ready';
      sessionId: string;
      speakText: string;
      voiceId: string;
      apiKey: string;
      model: string;
      languageBoost?: string;
    }
  | {
      /** 服务端文本处理失败（清洗/压缩/翻译异常） */
      type: 'speak_error';
      sessionId: string;
      reason: SpeakErrorReason;
      message: string;
    }
  | { type: 'pong' };

/**
 * HTTP GET，用 XMLHttpRequest 绕过 RN fetch polyfill 的 json() bug。
 * @param url 完整请求地址
 * @returns 响应体文本
 */
function httpGet(url: string): Promise<string> {
  logger.info(`${TAG} GET ${url}`);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = () => {
      logger.info(
        `${TAG} GET ${url} → ${xhr.status} ${xhr.responseText.substring(
          0,
          200
        )}`
      );
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => {
      logger.error(`${TAG} GET ${url} → network error`);
      reject(new Error('Network error'));
    };
    xhr.ontimeout = () => {
      logger.error(`${TAG} GET ${url} → timeout`);
      reject(new Error('Request timeout'));
    };
    xhr.send();
  });
}

/**
 * HTTP POST JSON，用 XMLHttpRequest 绕过 RN fetch polyfill 的 json() bug。
 *
 * 默认超时 120 秒：后端 chat 接口会阻塞到 AI 回复完成才返回，
 * 桌面端不设超时，移动端保留一个较长的兜底值防止永久挂起。
 * 配对等快速请求可通过 timeout 参数传入更短的超时。
 * @param url 完整请求地址
 * @param body 会被序列化为 JSON 的请求体
 * @param timeout 超时毫秒数，默认 120000
 * @returns 响应体文本
 */
export function httpPost(
  url: string,
  body: Record<string, unknown>,
  timeout?: number
): Promise<string> {
  logger.info(
    `${TAG} POST ${url} body=${JSON.stringify(body).substring(0, 200)}`
  );
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = timeout ?? 120000;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
      logger.info(
        `${TAG} POST ${url} → ${xhr.status} ${xhr.responseText.substring(
          0,
          200
        )}`
      );
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => {
      logger.error(`${TAG} POST ${url} → network error`);
      reject(new Error('Network error'));
    };
    xhr.ontimeout = () => {
      logger.error(`${TAG} POST ${url} → timeout`);
      reject(new Error('Request timeout'));
    };
    xhr.send(JSON.stringify(body));
  });
}

/**
 * HTTP DELETE，用 XMLHttpRequest 绕过 RN fetch polyfill 的 json() bug。
 * @param url 完整请求地址
 * @returns 响应体文本
 */
function httpDelete(url: string): Promise<string> {
  logger.info(`${TAG} DELETE ${url}`);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    xhr.open('DELETE', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = () => {
      logger.info(
        `${TAG} DELETE ${url} → ${xhr.status} ${xhr.responseText.substring(
          0,
          200
        )}`
      );
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => {
      logger.error(`${TAG} DELETE ${url} → network error`);
      reject(new Error('Network error'));
    };
    xhr.ontimeout = () => {
      logger.error(`${TAG} DELETE ${url} → timeout`);
      reject(new Error('Request timeout'));
    };
    xhr.send();
  });
}

/**
 * 在服务器上为指定 agent 创建新会话。
 * @param agentId Agent ID
 * @param serverAddress 服务器地址
 * @returns 新创建的会话 UUID
 */
export async function createSession(
  agentId: string,
  serverAddress: string
): Promise<string> {
  const url = `${serverAddress}/api/agents/${agentId}/sessions`;
  const responseText = await httpPost(url, {});
  const data = JSON.parse(responseText) as { session: { id: string } };
  logger.info(`${TAG} createSession → sessionId=${data.session.id}`);
  return data.session.id;
}

/**
 * 通过 HTTP POST 发送用户消息。服务器立即返回 `{ success: true }`，
 * AI 回复通过 WebSocket 的 step_complete / complete 事件异步到达。
 *
 * WebSocket 连接和消息接收由 ws-client 单例管理，
 * 调用方只需确保已通过 ws-client.subscribe 订阅了对应会话。
 *
 * @param agentId Agent ID
 * @param sessionId 服务器端会话 UUID
 * @param content 用户消息文本
 * @param serverAddress 服务器地址
 * @param voiceEnabled 是否开启语音，服务端据此决定是否发送 speak_ready
 */
export async function sendChatMessage(
  agentId: string,
  sessionId: string,
  content: string,
  serverAddress: string,
  voiceEnabled: boolean
): Promise<void> {
  logger.info(
    `${TAG} sendChatMessage agentId=${agentId} sessionId=${sessionId} content="${content.substring(
      0,
      80
    )}" voiceEnabled=${voiceEnabled}`
  );
  const url = `${serverAddress}/api/agents/${agentId}/sessions/${sessionId}/chat`;
  await httpPost(url, { content, voiceEnabled });
  logger.info(`${TAG} sendChatMessage sent ok`);
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  defaultModel: ModelConfig;
  systemPrompt: string;
  maxSteps: number;
  mcpNames: string[];
  skillNames: string[];
  defaultWorkspacePath?: string;
  voiceId?: string;
  /** 上下文压缩阈值（百分比 1–100） */
  compressionThreshold: number;
  /** 记忆整理（Dream）间隔（分钟） */
  dreamIntervalMinutes: number;
  /** 语音语言（映射到 MiniMax language_boost） */
  voiceLanguage?: string;
  createdAt: number;
  updatedAt: number;
}

/** MCP 服务器信息（对应 GET /api/mcp 返回的单个 server） */
export interface McpServerInfo {
  name: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'needs_auth';
  toolCount: number;
  error?: string;
  oauthUrl?: string;
}

/** Skill 信息（对应 GET /api/skills 返回的单个 skill） */
export interface SkillInfo {
  name: string;
  description: string;
}

/**
 * 拼接 Agent 头像图片的 HTTP 地址。
 * 服务器在 `GET /api/agents/:agentId/avatar` 返回 256x256 PNG。
 * @param agentId Agent ID
 * @param serverAddress 服务器地址
 * @returns 头像图片的完整 URL
 */
export function getAgentAvatarUrl(
  agentId: string,
  serverAddress: string
): string {
  return `${serverAddress}/api/agents/${agentId}/avatar`;
}

/**
 * 计算指定 Agent 的常驻聊天会话 ID。
 * 每个 Agent 恰好有一个常驻会话，ID 形如 `chat-{agentId}`，全局唯一。
 */
export function chatSessionIdFor(agentId: string): string {
  return `chat-${agentId}`;
}

/** 判断给定 sessionId 是否为常驻聊天会话 */
export function isChatSession(sessionId: string): boolean {
  return sessionId.startsWith('chat');
}

/**
 * 获取指定 Agent 可用的姿态列表。
 * 服务器在 GET /api/agents/:id/assets/pose 返回 { poses: string[] }。
 */
export async function fetchPoses(
  agentId: string,
  serverAddress: string
): Promise<string[]> {
  const url = `${serverAddress}/api/agents/${agentId}/assets/pose`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as { poses: string[] };
  return data.poses;
}

/**
 * 拼接 Agent 指定姿态的图片 URL。
 * 服务器在 GET /api/agents/:id/assets/pose/:name 返回图片流。
 */
export function getPoseImageUrl(
  agentId: string,
  poseName: string,
  serverAddress: string
): string {
  // URL 保持稳定以命中平台 HTTP 缓存，pose 切换靠路径里的 poseName 区分
  return `${serverAddress}/api/agents/${agentId}/assets/pose/${encodeURIComponent(
    poseName
  )}`;
}

/**
 * 拼接 Agent 背景图片 URL。
 * 服务器在 GET /api/agents/:id/assets/background 返回图片流。
 */
export function getBackgroundImageUrl(
  agentId: string,
  serverAddress: string
): string {
  // URL 保持稳定以命中平台 HTTP 缓存
  return `${serverAddress}/api/agents/${agentId}/assets/background`;
}

/**
 * 从服务器获取可用 agent 列表。
 * @param serverAddress 服务器地址
 * @returns agent 数组，每项含 id、name 等字段
 */
export async function fetchAgents(serverAddress: string): Promise<AgentInfo[]> {
  const url = `${serverAddress}/api/agents`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as {
    agents: AgentInfo[];
  };
  logger.info(
    `${TAG} fetchAgents → ${data.agents.length} agents: ${data.agents
      .map((a) => `${a.id}(${a.name})`)
      .join(', ')}`
  );
  return data.agents;
}

/**
 * 获取指定 agent 的完整信息（参照桌面端的 getAgent）。
 */
export async function fetchAgentDetail(
  serverAddress: string,
  agentId: string
): Promise<AgentInfo> {
  const url = `${serverAddress}/api/agents/${agentId}`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as { agent: AgentInfo };
  return data.agent;
}

/**
 * 获取服务器上所有 MCP 服务器列表（含连接状态和工具信息）。
 */
export async function fetchMcpServers(
  serverAddress: string
): Promise<McpServerInfo[]> {
  const url = `${serverAddress}/api/mcp`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as { servers: McpServerInfo[] };
  return data.servers;
}

/**
 * 获取服务器上所有技能列表（名称 + 描述）。
 */
export async function fetchSkills(serverAddress: string): Promise<SkillInfo[]> {
  const url = `${serverAddress}/api/skills`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as { skills: SkillInfo[] };
  return data.skills;
}

interface SessionMeta {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspacePath?: string;
  model: ModelConfig;
  /** 原始消息已压缩到的下标（仅聊天 Session）；undefined/0 表示尚未压缩 */
  summarizedUpTo?: number;
  /** 当前立绘表情名称；undefined 时前端 fallback 到 'default' */
  currentPose?: string;
}

interface Session extends SessionMeta {
  /** 消息列表，元素为 ServerChatMessage 扁平投影 */
  messages: ServerChatMessage[];
}

/** 历史消息中持久化的工具调用，结构对齐 @persona/shared 的 ToolCall */
interface ServerToolCall {
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

interface ServerChatMessage {
  /** @persona/shared Message 联合的简化投影，保留 role/content/thinking/tool_calls */
  role: 'user' | 'assistant' | 'system';
  content?: string;
  thinking?: string;
  tool_calls?: ServerToolCall[];
}

/**
 * 获取指定 agent 的所有会话列表，按 updatedAt 降序。
 */
export async function fetchSessions(
  serverAddress: string,
  agentId: string
): Promise<SessionMeta[]> {
  const url = `${serverAddress}/api/agents/${agentId}/sessions`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as { sessions: SessionMeta[] };
  logger.info(`${TAG} fetchSessions → ${data.sessions.length} sessions`);
  return data.sessions;
}

/**
 * 获取指定会话的完整消息列表。
 */
export async function fetchSessionMessages(
  serverAddress: string,
  agentId: string,
  sessionId: string
): Promise<Session> {
  const url = `${serverAddress}/api/agents/${agentId}/sessions/${sessionId}`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as { session: Session };
  logger.info(
    `${TAG} fetchSessionMessages → ${data.session.messages.length} messages`
  );
  return data.session;
}

/**
 * 删除指定会话。
 */
export async function deleteSession(
  serverAddress: string,
  agentId: string,
  sessionId: string
): Promise<void> {
  const url = `${serverAddress}/api/agents/${agentId}/sessions/${sessionId}`;
  await httpDelete(url);
  logger.info(`${TAG} deleteSession → ${sessionId}`);
}

/**
 * 将服务器返回的 Message[] 转换为 GiftedChat 能用的 ChatMessage[]。
 *
 * 合并连续的 assistant 消息为一个 ChatMessage，从 thinking/tool_calls/content 重建
 * 结构化 Thought[] 时间线，再经 stripLastTextThought 去重。最终反转为倒序。
 * 消息没有独立时间戳，用 session 的 createdAt 做基准，每条间隔 1 秒近似处理。
 */
export function convertToChatMessages(
  serverMessages: ServerChatMessage[],
  sessionCreatedAt: number,
  agentName: string,
  avatar: string
): ChatMessage[] {
  const result: ChatMessage[] = [];
  let pendingThoughts: Thought[] = [];
  let pendingContent = '';
  let pendingStartIndex = -1;

  /** 将缓冲的 assistant 消息合并为一条 ChatMessage 产出 */
  const flushPending = () => {
    if (pendingStartIndex === -1) {
      return;
    }
    const finalThoughts = stripLastTextThought(pendingThoughts);
    result.push({
      _id: uuid.v4(),
      text: pendingContent,
      steps: finalThoughts.length > 0 ? finalThoughts : undefined,
      createdAt: new Date(sessionCreatedAt + result.length * 1000),
      user: { _id: BOT_ID, name: agentName, avatar },
    });
    pendingThoughts = [];
    pendingContent = '';
    pendingStartIndex = -1;
  };

  for (let i = 0; i < serverMessages.length; i++) {
    const msg = serverMessages[i];

    if (msg.role === 'system') {
      continue;
    }

    if (msg.role === 'assistant') {
      if (pendingStartIndex === -1) {
        pendingStartIndex = i;
      }

      if (msg.thinking) {
        pendingThoughts.push({
          id: `thought-${i}-thinking`,
          type: 'thinking',
          content: msg.thinking,
        });
      }

      msg.tool_calls?.forEach((tc, tcIndex) => {
        pendingThoughts.push({
          id: `thought-${i}-tool-${tcIndex}`,
          type: 'tool_use',
          toolName: tc.function.name,
          toolInput: tc.function.arguments,
          toolResult: tc.toolResult
            ? { output: tc.toolResult.content, isError: tc.toolResult.isError }
            : undefined,
        });
      });

      if (msg.content) {
        pendingContent = msg.content;
        pendingThoughts.push({
          id: `thought-${i}-text`,
          type: 'text',
          content: msg.content,
        });
      }
    } else {
      flushPending();
      const text = typeof msg.content === 'string' ? msg.content : '';
      result.push({
        _id: uuid.v4(),
        text,
        createdAt: new Date(sessionCreatedAt + result.length * 1000),
        user: { _id: 1 },
      });
    }
  }
  flushPending();

  logger.info(
    `${TAG} convertToChatMessages → ${result.length} messages from ${serverMessages.length} raw`
  );
  return result.reverse();
}
