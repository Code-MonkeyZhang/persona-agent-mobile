/** 日志标签前缀 */
const TAG = '[NanoAgent]';

/** nano-agent 服务器通过 WebSocket 下发的所有消息类型 */
type ServerMessage =
  | { type: 'connected'; clientId: string }
  | { type: 'subscribed'; sessionId: string }
  | {
      type: 'step_complete';
      sessionId: string;
      stepIndex: number;
      content?: string;
      thinking?: string;
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
 * nano-agent 服务器客户端（HTTP + WebSocket）。
 *
 * 生命周期：connect → subscribe → sendChatMessage → 回调接收结果 → disconnect。
 * 断线自动重连，最多 5 次，线性退避。
 */
export class NanoAgentClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveConnect: (() => void) | null = null;
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

  /** WebSocket 是否处于 OPEN 状态 */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 连接到 nano-agent 服务器。
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

  /** 内部：创建 WebSocket 并绑定事件处理器，URL 由 http(s) 替换为 ws(s) + /ws */
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

  /** 内部：根据消息类型分发到对应回调 */
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

  /** 内部：线性退避重连，超过最大次数则 reject */
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

  /** 断开连接，取消重连定时器，置空 onclose 防止触发重连 */
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

/**
 * 从服务器获取可用 agent 列表。
 * @param serverAddress 服务器地址
 * @returns agent 数组，每项含 id 和 name
 */
export async function fetchAgents(
  serverAddress: string
): Promise<{ id: string; name: string }[]> {
  const url = `${serverAddress}/api/agents`;
  const responseText = await httpGet(url);
  const data = JSON.parse(responseText) as {
    agents: { id: string; name: string }[];
  };
  console.log(
    `${TAG} fetchAgents → ${data.agents.length} agents: ${data.agents
      .map(a => `${a.id}(${a.name})`)
      .join(', ')}`
  );
  return data.agents;
}
