/**
 * @file server-api.ts
 * @description Agent Server 的客户端封装，提供 HTTP 请求（获取 Agent/会话列表等）
 *              和 WebSocket 连接（流式接收 AI 回复）两种通信方式。
 */
import uuid from 'uuid';
import type { ChatMessage } from '../types/Chat.ts';

/** 日志标签前缀 */
const TAG = '[ServerApi]';

/** AI 消息的用户 ID，用于 GiftedChat 区分用户和 AI */
const BOT_ID = 2;

/** Agent Server 通过 WebSocket 下发的所有消息类型 */
type ServerMessage =
  | { type: 'connected'; clientId: string }
  | { type: 'subscribed'; sessionId: string }
  | {
      type: 'step_complete';
      sessionId: string;
      stepIndex: number;
      content?: string;
      thinking?: string;
      /** 工具调用结果列表（Step 3 预留字段，用于在陪伴模式中展示 AI 的工具调用过程） */
      toolCalls?: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }[];
    }
  | { type: 'complete'; sessionId: string }
  | { type: 'error'; sessionId?: string; message: string }
  | { type: 'title_updated'; sessionId: string; title: string }
  | { type: 'pong' };

/**
 * HTTP GET，用 XMLHttpRequest 绕过 RN fetch polyfill 的 json() bug。
 * @param url 完整请求地址
 * @returns 响应体文本
 */
function httpGet(url: string): Promise<string> {
  console.log(`${TAG} GET ${url}`);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = () => {
      console.log(
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
      console.log(`${TAG} GET ${url} → network error`);
      reject(new Error('Network error'));
    };
    xhr.ontimeout = () => {
      console.log(`${TAG} GET ${url} → timeout`);
      reject(new Error('Request timeout'));
    };
    xhr.send();
  });
}

/**
 * HTTP POST JSON，用 XMLHttpRequest 绕过 RN fetch polyfill 的 json() bug。
 * @param url 完整请求地址
 * @param body 会被序列化为 JSON 的请求体
 * @returns 响应体文本
 */
function httpPost(url: string, body: Record<string, unknown>): Promise<string> {
  console.log(
    `${TAG} POST ${url} body=${JSON.stringify(body).substring(0, 200)}`
  );
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
      console.log(
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
      console.log(`${TAG} POST ${url} → network error`);
      reject(new Error('Network error'));
    };
    xhr.ontimeout = () => {
      console.log(`${TAG} POST ${url} → timeout`);
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
  console.log(`${TAG} DELETE ${url}`);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    xhr.open('DELETE', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = () => {
      console.log(
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
      console.log(`${TAG} DELETE ${url} → network error`);
      reject(new Error('Network error'));
    };
    xhr.ontimeout = () => {
      console.log(`${TAG} DELETE ${url} → timeout`);
      reject(new Error('Request timeout'));
    };
    xhr.send();
  });
}

/**
 * Agent Server 客户端（HTTP + WebSocket）。
 *
 * 生命周期：connect → subscribe → sendChatMessage → 回调接收结果 → disconnect。
 * 断线自动重连，最多 5 次，线性退避。
 */
export class ServerClient {
  /** WebSocket 连接实例 */
  private ws: WebSocket | null = null;
  /** 当前已尝试的重连次数 */
  private reconnectAttempts = 0;
  /** 最大重连次数 */
  private maxReconnectAttempts = 5;
  /** 重连定时器 ID，disconnect 时需要清除 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** connect() 的 resolve 回调，收到 connected 消息时调用 */
  private resolveConnect: (() => void) | null = null;
  /** connect() 的 reject 回调，重连耗尽时调用 */
  private rejectConnect: ((err: Error) => void) | null = null;

  /** 收到 step_complete 事件时触发 */
  onStepComplete:
    | ((content: string | undefined, thinking: string | undefined) => void)
    | null = null;

  /** 收到 complete 事件时触发（agent 回复结束） */
  onComplete: (() => void) | null = null;

  /** 收到 error 事件时触发 */
  onError: ((message: string) => void) | null = null;

  /** 收到 title_updated 事件时触发 */
  onTitleUpdated: ((sessionId: string, title: string) => void) | null = null;

  /** 检查 WebSocket 是否处于 OPEN 状态 */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 连接到 Agent Server。
   * 先断开旧连接，等待服务器发送 connected 消息后 resolve。
   * @param serverAddress 服务器地址，如 `https://xxx.trycloudflare.com`
   */
  connect(serverAddress: string): Promise<void> {
    console.log(`${TAG} connect called, address=${serverAddress}`);
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.reconnectAttempts = 0;
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
      this.doConnect(serverAddress);
    });
  }

  /**
   * 创建 WebSocket 连接并绑定 onopen/onmessage/onclose/onerror 回调。
   * 将 http(s) 地址转换为 ws(s) + /ws 路径。
   * @param serverAddress 服务器 HTTP 地址
   */
  private doConnect(serverAddress: string) {
    const wsUrl = serverAddress.replace(/^https?/, 'wss') + '/ws';
    console.log(`${TAG} WebSocket connecting to ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log(`${TAG} WebSocket onopen`);
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const raw = event.data as string;
        const msg: ServerMessage = JSON.parse(raw);
        console.log(
          `${TAG} WS ← ${msg.type}${
            msg.type === 'step_complete'
              ? ` step=${(msg as { stepIndex: number }).stepIndex} content=${(
                  (msg as { content?: string }).content || ''
                ).substring(0, 80)}`
              : ''
          }${
            msg.type === 'error'
              ? ` message=${(msg as { message: string }).message}`
              : ''
          }${
            msg.type === 'title_updated'
              ? ` title=${(msg as { title: string }).title}`
              : ''
          }`
        );
        this.handleMessage(msg);
      } catch {
        console.log(
          `${TAG} WS ← parse error: ${(event.data as string).substring(0, 100)}`
        );
      }
    };

    this.ws.onclose = () => {
      console.log(
        `${TAG} WebSocket onclose, will attempt reconnect=${
          this.reconnectAttempts < this.maxReconnectAttempts
        }`
      );
      this.attemptReconnect(serverAddress);
    };

    this.ws.onerror = () => {
      console.log(`${TAG} WebSocket onerror`);
    };
  }

  /**
   * 根据消息类型分发到对应的外部回调。
   * @param msg 服务器下发的消息对象
   */
  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'connected':
        console.log(`${TAG} WS connected, clientId=${msg.clientId}`);
        if (this.resolveConnect) {
          this.resolveConnect();
          this.resolveConnect = null;
          this.rejectConnect = null;
        }
        break;
      case 'step_complete':
        if (this.onStepComplete) {
          this.onStepComplete(msg.content, msg.thinking);
        }
        break;
      case 'complete':
        console.log(`${TAG} WS complete, sessionId=${msg.sessionId}`);
        if (this.onComplete) {
          this.onComplete();
        }
        break;
      case 'error':
        console.log(`${TAG} WS error: ${msg.message}`);
        if (this.onError) {
          this.onError(msg.message);
        }
        break;
      case 'title_updated':
        if (this.onTitleUpdated) {
          this.onTitleUpdated(msg.sessionId, msg.title);
        }
        break;
    }
  }

  /**
   * 线性退避重连：每次重连间隔递增 1 秒，超过最大次数则拒绝 connect Promise。
   * @param serverAddress 服务器地址
   */
  private attemptReconnect(serverAddress: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(
        `${TAG} reconnect exhausted (${this.maxReconnectAttempts} attempts)`
      );
      if (this.rejectConnect) {
        this.rejectConnect(new Error('Connection failed after max retries'));
        this.rejectConnect = null;
        this.resolveConnect = null;
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = 1000 * this.reconnectAttempts;
    console.log(
      `${TAG} reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.doConnect(serverAddress);
    }, delay);
  }

  /**
   * 断开 WebSocket 连接，清除重连定时器，置空所有回调防止内存泄漏。
   */
  disconnect() {
    console.log(`${TAG} disconnect`);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.resolveConnect = null;
    this.rejectConnect = null;
  }

  /**
   * 订阅某个会话的 WebSocket 事件。
   * @param sessionId 服务器端会话 UUID
   */
  subscribe(sessionId: string) {
    console.log(`${TAG} WS → subscribe sessionId=${sessionId}`);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: 'subscribe', payload: { sessionId } })
      );
    } else {
      console.log(
        `${TAG} subscribe skipped, ws not open (state=${this.ws?.readyState})`
      );
    }
  }

  /**
   * 在服务器上为指定 agent 创建新会话。
   * @param agentId Agent ID
   * @param serverAddress 服务器地址
   * @returns 新创建的会话 UUID
   */
  async createSession(agentId: string, serverAddress: string): Promise<string> {
    const url = `${serverAddress}/api/agents/${agentId}/sessions`;
    const responseText = await httpPost(url, {});
    const data = JSON.parse(responseText) as { session: { id: string } };
    console.log(`${TAG} createSession → sessionId=${data.session.id}`);
    return data.session.id;
  }

  /**
   * 通过 HTTP POST 发送用户消息。服务器立即返回 `{ success: true }`，
   * AI 回复通过 WebSocket 的 step_complete / complete 事件异步到达。
   * @param agentId Agent ID
   * @param sessionId 服务器端会话 UUID
   * @param content 用户消息文本
   * @param serverAddress 服务器地址
   */
  async sendChatMessage(
    agentId: string,
    sessionId: string,
    content: string,
    serverAddress: string
  ): Promise<void> {
    console.log(
      `${TAG} sendChatMessage agentId=${agentId} sessionId=${sessionId} content="${content.substring(
        0,
        80
      )}"`
    );
    const url = `${serverAddress}/api/agents/${agentId}/sessions/${sessionId}/chat`;
    await httpPost(url, { content });
    console.log(`${TAG} sendChatMessage sent ok`);
  }
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  defaultModel?: { provider: string; model: string };
  systemPrompt?: string;
  maxSteps?: number;
  mcpNames?: string[];
  skillNames?: string[];
  defaultWorkspacePath?: string;
}

/** MCP 服务器信息（对应 GET /api/mcp 返回的单个 server） */
export interface McpServerInfo {
  name: string;
  status: 'disconnected' | 'connecting' | 'connected';
  tools: { id: string; name: string; description: string }[];
  error?: string;
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
  // ?t= 时间戳参数破坏浏览器/React Native 图片缓存，确保 pose 切换后能看到最新图片
  return `${serverAddress}/api/agents/${agentId}/assets/pose/${encodeURIComponent(
    poseName
  )}?t=${Date.now()}`;
}

/**
 * 拼接 Agent 背景图片 URL。
 * 服务器在 GET /api/agents/:id/assets/background 返回图片流。
 */
export function getBackgroundImageUrl(
  agentId: string,
  serverAddress: string
): string {
  // ?t= 时间戳参数破坏缓存，确保背景图更新后能立即刷新
  return `${serverAddress}/api/agents/${agentId}/assets/background?t=${Date.now()}`;
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
  console.log(
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
  messageCount: number;
}

interface Session extends SessionMeta {
  messages: ServerChatMessage[];
}

interface ServerChatMessage {
  role: 'user' | 'assistant' | 'system';
  content?: string;
  thinking?: string;
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
  console.log(`${TAG} fetchSessions → ${data.sessions.length} sessions`);
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
  console.log(
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
  console.log(`${TAG} deleteSession → ${sessionId}`);
}

/**
 * 将服务器返回的 Message[] 转换为 GiftedChat 能用的 ChatMessage[]。
 *
 * 处理逻辑：过滤 system 消息 → 为每条消息生成 uuid → 反转为倒序（GiftedChat 要求）。
 * 消息没有独立时间戳，用 session 的 createdAt 做基准，每条消息间隔 1 秒近似处理。
 */
export function convertToChatMessages(
  serverMessages: ServerChatMessage[],
  sessionCreatedAt: number
): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of serverMessages) {
    if (msg.role === 'system') {
      continue;
    }

    if (msg.role === 'user') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      result.push({
        _id: uuid.v4(),
        text,
        createdAt: new Date(sessionCreatedAt + result.length * 1000),
        user: { _id: 1 },
      });
    } else if (msg.role === 'assistant') {
      const text = msg.content || '';
      result.push({
        _id: uuid.v4(),
        text,
        reasoning: msg.thinking,
        createdAt: new Date(sessionCreatedAt + result.length * 1000),
        user: { _id: BOT_ID, name: 'AI' },
      });
    }
  }
  return result.reverse();
}
