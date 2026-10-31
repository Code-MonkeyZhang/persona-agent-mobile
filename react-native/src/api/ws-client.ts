/**
 * @file api/ws-client.ts
 * @description WebSocket 全局单例模块。
 *   管理 WebSocket 连接的完整生命周期：建连、register 声明设备身份、
 *   服务端保活下的下行新鲜度看门狗、窗口限期的指数退避重连、消息路由。
 *
 * 消息路由规则：
 *   - 状态型消息（title_updated）直接写 sessionStore，不经 handler
 *   - 事件型消息（step_complete / turn_complete / round_complete / error / speak_ready / speak_error / app_notification / pending_input_changed / user_message）携带 sessionId 转给注册的 handler
 *   - connected / keepalive 在模块内部处理
 */
import type {
  ServerMessage,
  ToolCall,
  WsToolResult,
  SpeakErrorReason,
  PendingInput,
  CurrentActivity,
  RunningSessionEntry,
} from './server-api.ts';
import type { SessionChange } from '../storage/sync-shapes.ts';
import { useSessionStore } from '../stores/sessionStore.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { getDeviceId, getCachedDeviceName } from '../utils/DeviceUtils.ts';
import { logger } from '../lib/logger';

const TAG = '[WsClient]';

/** 看门狗检查节拍，与服务端保活节拍同量级 */
const WATCHDOG_CHECK_INTERVAL = 5_000;
/** 建立连接的超时，超时经 close 走统一重连路径 */
const CONNECT_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 10_000;
/** 密集重连的期限，耗尽即进入离线态停止空转 */
const RECONNECT_WINDOW_MS = 40_000;
/** 连接稳定存活的判定时长，达到才算新断线事件并重置窗口与退避 */
const STABLE_CONNECTION_MS = 10_000;
/** 离线态的前台慢重试节拍，后台冻结期间定时器自然停转 */
const OFFLINE_RETRY_INTERVAL_MS = 60_000;

/** 事件型消息处理器接口，由 chatStore 注册，事件按所属 sessionId 路由到对应会话分片 */
export interface WsEventHandler {
  onStepComplete(
    sessionId: string,
    content?: string,
    thinking?: string,
    toolCalls?: ToolCall[],
    toolResults?: WsToolResult[]
  ): void;
  /** 工具调用开始事件，时间线据此立即开活动步显示执行中的工具身份 */
  onToolStarted(
    sessionId: string,
    stepIndex: number,
    toolName: string,
    paramSummary: string
  ): void;
  /** 轮次边界信号，客户端据此把轮次缓冲组装成整轮气泡，生成状态保持 */
  onTurnComplete(sessionId: string): void;
  onComplete(sessionId: string): void;
  onError(sessionId: string, message: string): void;
  onSpeakReady(
    sessionId: string,
    data: {
      speakText: string;
      voiceId: string;
      apiKey: string;
      model: string;
      languageBoost?: string;
    }
  ): void;
  onSpeakError(
    sessionId: string,
    reason: SpeakErrorReason,
    message: string
  ): void;
  /** 用户中止生成后服务端推送的确认事件 */
  onAborted(sessionId: string): void;
  /** 订阅成功时服务端返回的会话状态，isGenerating 为 true 时前端恢复加载动画，currentActivity 携带当前动作 */
  onSubscribed(
    sessionId: string,
    isGenerating: boolean,
    activity?: CurrentActivity
  ): void;
  /** 回合开始的全局广播，运行集合据此添加，归属完整时头像运行圈一并起转 */
  onRunStarted(sessionId: string, agentId?: string): void;
  /** 回合结束的全局广播，完成、出错与中止共用，运行集合据此移除 */
  onRunEnded(sessionId: string): void;
  /** 连接建立时的运行中会话全量列表，运行集合整体替换补态，带归属时维护 Agent 集合 */
  onRunsSnapshot(sessionIds: string[], runs?: RunningSessionEntry[]): void;
  /** App 通知触发的回合开始信号，客户端据此放占位气泡并切入生成状态 */
  onAppNotification(sessionId: string, source: string, content: string): void;
  /** 普通用户消息落盘广播，空闲时据此追加用户气泡并切入生成态 */
  onUserMessage(sessionId: string, content: string): void;
  /** 待注入缓冲全量同步，忙时插话的灰气泡据此渲染 */
  onPendingChanged(sessionId: string, pending: PendingInput[]): void;
}

let ws: WebSocket | null = null;
let serverAddress = '';
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let offlineRetryTimer: ReturnType<typeof setInterval> | null = null;
/** 最近一条下行到达时间，看门狗据此判定连接新鲜度 */
let lastDownlinkAt = 0;
/** 下行断供阈值，服务端在 connected 消息声明节拍后按三倍推导，null 表示未武装 */
let stallThresholdMs: number | null = null;
/** 当前断线事件的窗口起点，连接稳定存活满 10 秒才视为新事件周期 */
let reconnectWindowStart = 0;
/** 当前连接的打开时刻，关闭时据此判定存活时长 */
let openedAt: number | null = null;
/** 是否处于离线终态，慢重试期间保持 true 避免状态来回翻 */
let offline = false;
/** 当前订阅的会话 ID，WS 重连后自动补发 subscribe */
let subscribedSessionId: string | null = null;
/** 当前注册的事件型消息处理器 */
let currentHandler: WsEventHandler | null = null;
/** 当前注册的同步消息处理器，镜像引擎在装配时注册 */
let currentSyncHandler: ((change: SessionChange) => void) | null = null;
/** 区分主动断开和网络断开，只有网络断开才重连 */
let isIntentionalDisconnect = false;

/**
 * 建立 WebSocket 连接。
 * 如果已有连接会先断开旧连接，但保留当前会话订阅以便重连后自动补发。
 * 连接成功后自动发送 register、补发缓存的 subscribe、启动看门狗。
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
  isIntentionalDisconnect = false;
  clearTimers();
  cleanupSocket();

  serverAddress = address;
  reconnectAttempts = 0;
  reconnectWindowStart = 0;
  openedAt = null;
  stallThresholdMs = null;
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

/** 清当前会话订阅，切换主机后旧主机的会话身份不再随重连补发 */
export function clearSubscription(): void {
  subscribedSessionId = null;
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

/**
 * 上报进入会话的已读，服务端据此清除 hasUnread 并经变更流广播全端。
 * WS 未连上时直接放弃，重连追平后镜像携带的未读会再次触发上报。
 */
export function viewed(sessionId: string): void {
  logger.info(`${TAG} → viewed sessionId=${sessionId}`);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'viewed', payload: { sessionId } }));
  } else {
    logger.warn(`${TAG} viewed skipped, ws not open`);
  }
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

/** 注册事件型消息处理器，chatStore 模块加载时调用一次 */
export function registerHandler(handler: WsEventHandler): void {
  currentHandler = handler;
  logger.info(`${TAG} handler registered`);
}

/** 注册同步消息处理器，镜像引擎装配时调用一次 */
export function registerSyncHandler(
  handler: (change: SessionChange) => void
): void {
  currentSyncHandler = handler;
  logger.info(`${TAG} sync handler registered`);
}

/**
 * 创建 WebSocket 连接并绑定事件回调。
 * 将 http(s) 地址转换为 ws(s) + /ws 路径，15 秒未握手完成经 close 走统一重连路径。
 */
function doConnect(): void {
  const wsUrl = serverAddress.replace(/^https?/, 'wss') + '/ws';
  logger.info(`${TAG} connecting to ${wsUrl}`);
  const socket = new WebSocket(wsUrl);
  ws = socket;

  connectTimer = setTimeout(() => {
    if (ws !== socket) return;
    logger.warn(`${TAG} connect timeout, closing`);
    socket.close();
  }, CONNECT_TIMEOUT_MS);

  socket.onopen = () => {
    if (ws !== socket) return;
    logger.info(`${TAG} onopen`);
    clearTimers();
    openedAt = Date.now();

    const deviceId = getDeviceId();
    const deviceName = getCachedDeviceName();
    socket.send(
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
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          payload: { sessionId: subscribedSessionId },
        })
      );
    }

    startWatchdog(socket);
  };

  socket.onmessage = (event: WebSocketMessageEvent) => {
    if (ws !== socket) return;
    try {
      const msg: ServerMessage = JSON.parse(event.data as string);
      lastDownlinkAt = Date.now();
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

  socket.onclose = () => {
    if (ws !== socket) return;
    logger.warn(`${TAG} onclose`);
    stopWatchdog();
    clearConnectTimer();
    if (isIntentionalDisconnect) {
      return;
    }
    // 离线态的慢重试失败不再翻 reconnecting，界面保持未连接
    if (!offline) {
      useConnectionStore.getState().setStatus('reconnecting');
    }
    evaluateStability();
    attemptReconnect();
  };

  socket.onerror = () => {
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
      // 服务端声明保活节拍即武装看门狗，阈值取三倍，缺失说明旧服务端不发保活保持关闭
      stallThresholdMs =
        msg.keepaliveIntervalMs === undefined
          ? null
          : msg.keepaliveIntervalMs * 3;
      logger.info(`${TAG} connected, clientId=${msg.clientId}`);
      useConnectionStore.getState().setStatus('connected');
      break;

    case 'subscribed':
      logger.info(
        `${TAG} subscribed, sessionId=${msg.sessionId} isGenerating=${
          msg.isGenerating ?? false
        }`
      );
      currentHandler?.onSubscribed(
        msg.sessionId,
        msg.isGenerating ?? false,
        msg.currentActivity
      );
      break;

    case 'run_started':
      logger.info(
        `${TAG} run_started, sessionId=${msg.sessionId} agentId=${
          msg.agentId ?? 'unknown'
        }`
      );
      currentHandler?.onRunStarted(msg.sessionId, msg.agentId);
      break;

    case 'run_ended':
      logger.info(
        `${TAG} run_ended, sessionId=${msg.sessionId} agentId=${
          msg.agentId ?? 'unknown'
        }`
      );
      currentHandler?.onRunEnded(msg.sessionId);
      break;

    case 'runs_snapshot':
      logger.info(
        `${TAG} runs_snapshot, count=${
          msg.sessionIds.length
        } ids=[${msg.sessionIds.join(',')}] runs=${msg.runs?.length ?? 0}`
      );
      currentHandler?.onRunsSnapshot(msg.sessionIds, msg.runs);
      break;

    case 'keepalive':
      // 到达时间已在 onmessage 记录，此处无需处理
      break;

    case 'title_updated':
      useSessionStore.getState().updateSessionTitle(msg.sessionId, msg.title);
      break;

    case 'tool_started':
      logger.info(
        `${TAG} tool_started, sessionId=${msg.sessionId} step=${msg.stepIndex} tool=${msg.toolName}`
      );
      currentHandler?.onToolStarted(
        msg.sessionId,
        msg.stepIndex,
        msg.toolName,
        msg.paramSummary
      );
      break;

    case 'step_complete':
      currentHandler?.onStepComplete(
        msg.sessionId,
        msg.content,
        msg.thinking,
        msg.toolCalls,
        msg.toolResults
      );
      break;

    case 'round_complete':
      logger.info(`${TAG} round_complete, sessionId=${msg.sessionId}`);
      currentHandler?.onComplete(msg.sessionId);
      break;

    case 'turn_complete':
      logger.info(`${TAG} turn_complete, sessionId=${msg.sessionId}`);
      currentHandler?.onTurnComplete(msg.sessionId);
      break;

    case 'error':
      logger.error(`${TAG} error: ${msg.message}`);
      currentHandler?.onError(msg.sessionId, msg.message);
      break;

    case 'aborted':
      logger.info(`${TAG} aborted, sessionId=${msg.sessionId}`);
      currentHandler?.onAborted(msg.sessionId);
      break;

    case 'app_notification':
      logger.info(
        `${TAG} app_notification, sessionId=${msg.sessionId} source=${msg.source}`
      );
      currentHandler?.onAppNotification(msg.sessionId, msg.source, msg.content);
      break;

    case 'pending_input_changed':
      logger.info(
        `${TAG} pending_input_changed, sessionId=${msg.sessionId} count=${msg.pending.length}`
      );
      currentHandler?.onPendingChanged(msg.sessionId, msg.pending);
      break;

    case 'user_message':
      logger.info(
        `${TAG} user_message, sessionId=${msg.sessionId} contentLen=${msg.content.length}`
      );
      currentHandler?.onUserMessage(msg.sessionId, msg.content);
      break;

    case 'speak_ready':
      logger.info(
        `${TAG} speak_ready, sessionId=${msg.sessionId} textLen=${msg.speakText.length}`
      );
      currentHandler?.onSpeakReady(msg.sessionId, msg);
      break;

    case 'speak_error':
      logger.error(
        `${TAG} speak_error, reason=${msg.reason} message=${msg.message}`
      );
      currentHandler?.onSpeakError(msg.sessionId, msg.reason, msg.message);
      break;

    case 'change':
      logger.debug(
        `${TAG} change, seq=${msg.change.seq} kind=${msg.change.kind}`
      );
      currentSyncHandler?.(msg.change);
      break;
  }
}

/**
 * 启动下行新鲜度看门狗，只收不发。
 * 连接健康时保活或业务消息持续刷新到达时间，超阈值无任何下行即判静默死亡，主动掐断走统一重连路径。
 * 检查被节流时只会晚发现，不会误杀。
 */
function startWatchdog(socket: WebSocket): void {
  stopWatchdog();
  lastDownlinkAt = Date.now();
  watchdogTimer = setInterval(() => {
    if (ws !== socket) return;
    if (stallThresholdMs === null) return;
    if (Date.now() - lastDownlinkAt > stallThresholdMs) {
      logger.warn(`${TAG} downlink stalled, closing to reconnect`);
      socket.close();
    }
  }, WATCHDOG_CHECK_INTERVAL);
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

/**
 * 依据连接存活时长判定是否为新的断线事件。
 * 稳定满 10 秒才重置窗口与退避计数，短命连接视为同一事件的失败尝试，
 * 半死服务端的连断循环因此自然耗尽窗口进入离线态，界面不再无限闪跳。
 */
function evaluateStability(): void {
  const startedAt = openedAt;
  openedAt = null;
  if (startedAt === null || Date.now() - startedAt < STABLE_CONNECTION_MS) {
    return;
  }
  logger.info(`${TAG} stable connection ended, resetting window`);
  reconnectAttempts = 0;
  reconnectWindowStart = 0;
}

/**
 * 指数退避重连，重连窗口 40 秒耗尽即进入离线态。
 * 窗口起点只在断线事件首轮记录，稳定连接断开或拨号失败都不重开窗口。
 */
function attemptReconnect(): void {
  if (!reconnectWindowStart) {
    reconnectWindowStart = Date.now();
  }
  if (Date.now() - reconnectWindowStart >= RECONNECT_WINDOW_MS) {
    enterOffline();
    return;
  }
  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY * 2 ** (reconnectAttempts - 1),
    RECONNECT_MAX_DELAY
  );
  logger.warn(`${TAG} reconnect in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    doConnect();
  }, delay);
}

/**
 * 进入离线态，界面翻未连接，密集重试停止，前台慢重试接管。
 * 慢重试失败回流的 onclose 走耗尽分支，离线态保持不翻，回前台的冷启动链负责焕新。
 */
function enterOffline(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (offline) return;
  offline = true;
  logger.warn(`${TAG} reconnect window exhausted, offline`);
  useConnectionStore.getState().setStatus('offline');
  offlineRetryTimer = setInterval(() => {
    logger.info(`${TAG} offline retry`);
    reconnectAttempts = 0;
    doConnect();
  }, OFFLINE_RETRY_INTERVAL_MS);
}

function clearConnectTimer(): void {
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
}

function clearTimers(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearConnectTimer();
  stopWatchdog();
  if (offlineRetryTimer) {
    clearInterval(offlineRetryTimer);
    offlineRetryTimer = null;
  }
  offline = false;
}
