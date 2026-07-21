/**
 * @file api/ws-client.ts
 * @description WebSocket 全局单例模块。
 *   管理 WebSocket 连接的完整生命周期：建连、register 声明设备身份、
 *   30 秒心跳保活、永不放弃的线性退避重连、消息路由。
 *
 * 消息路由规则：
 *   - 状态型消息（title_updated）直接写 sessionStore，不经 handler
 *   - 事件型消息（step_complete / complete / error / speak_ready / speak_error）转给注册的 handler
 *   - connected / pong 在模块内部处理
 */
import type {
  ServerMessage,
  ToolCall,
  WsToolResult,
  SpeakErrorReason,
} from './server-api.ts';
import { useSessionStore } from '../stores/sessionStore.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { getDeviceId, getCachedDeviceName } from '../utils/DeviceUtils.ts';
import { logger } from '../lib/logger';

const TAG = '[WsClient]';

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_BASE_DELAY = 3_000;
const RECONNECT_MAX_DELAY = 300_000;

/** 事件型消息处理器接口，由 ChatScreen 注册 */
export interface WsEventHandler {
  onStepComplete(
    content?: string,
    thinking?: string,
    toolCalls?: ToolCall[],
    toolResults?: WsToolResult[]
  ): void;
  onComplete(): void;
  onError(message: string): void;
  onSpeakReady(data: {
    speakText: string;
    voiceId: string;
    apiKey: string;
    model: string;
    languageBoost?: string;
  }): void;
  onSpeakError(reason: SpeakErrorReason, message: string): void;
  /** 用户中止生成后服务端推送的确认事件 */
  onAborted(): void;
}

let ws: WebSocket | null = null;
let serverAddress = '';
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
/** 心跳标志：每轮 ping 前检查上一轮 pong 是否已收到 */
let pongReceived = true;
/** 当前订阅的会话 ID，WS 重连后自动补发 subscribe */
let subscribedSessionId: string | null = null;
/** 当前注册的事件型消息处理器 */
let currentHandler: WsEventHandler | null = null;
/** 区分主动断开和网络断开，只有网络断开才重连 */
let isIntentionalDisconnect = false;

/**
 * 建立 WebSocket 连接。
 * 如果已有连接会先断开旧连接，但保留当前会话订阅以便重连后自动补发。
 * 连接成功后自动发送 register、补发缓存的 subscribe、启动心跳。
 */
/** 移除所有事件回调并关闭当前 WebSocket 连接 */
function cleanupSocket(): void {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onopen = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
}

export function connect(address: string): void {
  clearTimers();
  cleanupSocket();

  serverAddress = address;
  isIntentionalDisconnect = false;
  reconnectAttempts = 0;
  doConnect();
}

/** 主动断开连接，不触发重连 */
export function disconnect(): void {
  logger.info(`${TAG} disconnect`);
  isIntentionalDisconnect = true;
  clearTimers();
  cleanupSocket();
  subscribedSessionId = null;
}

/**
 * 订阅某个会话的 WebSocket 事件。
 * 如果当前 WebSocket 未就绪，先缓存 sessionId，等连接建立或重连后在 onopen 中自动补发。
 */
export function subscribe(sessionId: string): void {
  subscribedSessionId = sessionId;
  logger.info(`${TAG} → subscribe sessionId=${sessionId}`);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', payload: { sessionId } }));
  } else {
    logger.warn(`${TAG} subscribe deferred, ws not open`);
  }
}

/**
 * 请求服务端中止指定会话的当前生成。
 * WS 未连上时直接放弃，生成不可能在跑，abort 无意义。
 */
export function abort(sessionId: string): void {
  logger.info(`${TAG} → abort sessionId=${sessionId}`);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'abort', payload: { sessionId } }));
  } else {
    logger.warn(`${TAG} abort skipped, ws not open`);
  }
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

/** 注册事件型消息处理器 */
export function registerHandler(handler: WsEventHandler): void {
  currentHandler = handler;
  logger.info(`${TAG} handler registered`);
}

/** 注销事件型消息处理器 */
export function unregisterHandler(): void {
  currentHandler = null;
  logger.info(`${TAG} handler unregistered`);
}

/**
 * 创建 WebSocket 连接并绑定事件回调。
 * 将 http(s) 地址转换为 ws(s) + /ws 路径。
 */
function doConnect(): void {
  const wsUrl = serverAddress.replace(/^https?/, 'wss') + '/ws';
  logger.info(`${TAG} connecting to ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    logger.info(`${TAG} onopen`);
    reconnectAttempts = 0;
    pongReceived = true;

    const deviceId = getDeviceId();
    const deviceName = getCachedDeviceName();
    ws!.send(
      JSON.stringify({
        type: 'register',
        deviceId,
        deviceType: 'mobile',
        deviceName,
      })
    );
    logger.info(
      `${TAG} → register deviceId=${deviceId} deviceName=${deviceName}`
    );

    if (subscribedSessionId) {
      logger.info(`${TAG} re-subscribe sessionId=${subscribedSessionId}`);
      ws!.send(
        JSON.stringify({
          type: 'subscribe',
          payload: { sessionId: subscribedSessionId },
        })
      );
    }

    startHeartbeat();
  };

  ws.onmessage = (event: WebSocketMessageEvent) => {
    try {
      const msg: ServerMessage = JSON.parse(event.data as string);
      logger.debug(
        `${TAG} ← ${msg.type}${
          msg.type === 'step_complete'
            ? ` step=${(msg as { stepIndex: number }).stepIndex}`
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
      handleMessage(msg);
    } catch {
      logger.error(
        `${TAG} parse error: ${(event.data as string).substring(0, 100)}`
      );
    }
  };

  ws.onclose = () => {
    logger.warn(`${TAG} onclose`);
    stopHeartbeat();
    if (isIntentionalDisconnect) {
      return;
    }
    useConnectionStore.getState().setStatus('reconnecting');
    attemptReconnect();
  };

  ws.onerror = () => {
    logger.error(`${TAG} onerror`);
  };
}

/**
 * 根据消息类型路由：
 *   - 状态型直接写 store
 *   - 事件型转给 currentHandler
 */
function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'connected':
      logger.info(`${TAG} connected, clientId=${msg.clientId}`);
      useConnectionStore.getState().setStatus('connected');
      break;

    case 'pong':
      pongReceived = true;
      break;

    case 'title_updated':
      useSessionStore.getState().updateSessionTitle(msg.sessionId, msg.title);
      break;

    case 'step_complete':
      currentHandler?.onStepComplete(
        msg.content,
        msg.thinking,
        msg.toolCalls,
        msg.toolResults
      );
      break;

    case 'complete':
      logger.info(`${TAG} complete, sessionId=${msg.sessionId}`);
      currentHandler?.onComplete();
      break;

    case 'error':
      logger.error(`${TAG} error: ${msg.message}`);
      currentHandler?.onError(msg.message);
      break;

    case 'aborted':
      logger.info(`${TAG} aborted, sessionId=${msg.sessionId}`);
      currentHandler?.onAborted();
      break;

    case 'speak_ready':
      logger.info(
        `${TAG} speak_ready, sessionId=${msg.sessionId} textLen=${msg.speakText.length}`
      );
      currentHandler?.onSpeakReady(msg);
      break;

    case 'speak_error':
      logger.error(
        `${TAG} speak_error, reason=${msg.reason} message=${msg.message}`
      );
      currentHandler?.onSpeakError(msg.reason, msg.message);
      break;
  }
}

/**
 * 心跳保活：每 30 秒发 ping。
 * 如果上一轮的 pong 未收到，主动 close 触发重连。
 */
function startHeartbeat(): void {
  stopHeartbeat();
  pongReceived = true;
  heartbeatTimer = setInterval(() => {
    if (!pongReceived) {
      logger.warn(
        `${TAG} heartbeat: pong timeout, closing to trigger reconnect`
      );
      ws?.close();
      return;
    }
    pongReceived = false;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * 线性退避重连：3 秒起步，每次递增，封顶 5 分钟，永不放弃。
 */
function attemptReconnect(): void {
  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY * reconnectAttempts,
    RECONNECT_MAX_DELAY
  );
  logger.warn(`${TAG} reconnect in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    doConnect();
  }, delay);
}

function clearTimers(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
}
