/**
 * @file stores/chatStore.ts
 * @description 会话仓库：按 sessionId 分片保存消息、生成状态与陪伴姿态。
 *   - WS 事件处理在模块加载时注册一次永不注销，事件按消息携带的 sessionId 写入对应分片
 *   - 发送链路与追平补拉收敛于此，页面卸载重建后数据与流式回合不丢
 *   - 远端用户消息经 user_message 事件实时追加并切入生成态，回声由运行态守卫拦截
 *   - 生成期间消息流无占位气泡，轮次步骤进响应式 store 外的缓冲，步骤到达零渲染，turn_complete 到达组装整轮气泡
 *   - 忙时插话进服务端待注入缓冲，灰气泡由 pending_input_changed 广播渲染
 *   - 页面只是订阅者，ChatScreen 不再持有消息状态
 */
import { create } from 'zustand';
import { GiftedChat } from 'react-native-gifted-chat';
import { v4 as uuidv4 } from 'uuid';
import * as wsClient from '../api/ws-client.ts';
import {
  createSession,
  sendChatMessage,
  fetchSessionMessages,
  convertToChatMessages,
  chatSessionIdFor,
  stripLastTextThought,
  type PendingInput,
  type ServerChatMessage,
  type ToolCall,
  type WsToolResult,
} from '../api/server-api.ts';
import {
  getServerAddress,
  getServerAgentId,
  saveLastConversation,
} from '../storage/StorageUtils.ts';
import { cacheDb } from '../storage/cache-db.ts';
import {
  toServerChatMessages,
  type CompressionFailReason,
  type CompressionRecord,
  type UsageState,
} from '../storage/sync-shapes.ts';
import { useMirrorStore } from '../stores/mirrorStore.ts';
import {
  toContentBlocks,
  fromContentBlocks,
  resolveTimelineIconUrl,
} from '../api/server-api.ts';
import { getDeviceId } from '../utils/DeviceUtils.ts';
import { summarizeToolInput, successfulPose } from '../lib/tool-summary.ts';
import { type LiveRunState, type LiveStep } from '../chat/component/LiveStrip';
import {
  useSessionStore,
  extractPreview,
  NEW_CHAT_SESSION,
} from './sessionStore.ts';
import { useVoiceStore } from './voiceStore.ts';
import { trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import i18n from '../i18n/index';
import type { ChatMessage, ContentBlock, FileInfo } from '../types/Chat.ts';
import type { Thought } from '../types/Thought';
import { ChatStatus } from '../types/Chat.ts';

const TAG = '[ChatStore]';

export const BOT_ID = 2;
export const textPlaceholder = '...';
/** 空消息数组的模块级常量，避免组件内兜底取值每次产生新引用引发多余渲染 */
export const EMPTY_MESSAGES: ChatMessage[] = [];

/** 创建一条 AI 气泡消息，轮次组装与错误提示的公共构造 */
const createBotMessage = (): ChatMessage => ({
  _id: uuidv4(),
  text: textPlaceholder,
  createdAt: new Date(),
  user: { _id: BOT_ID },
  steps: [],
});

/** 解析用户消息载荷为正文与附件，插话灰气泡与远端用户气泡共用 */
function parseUserContent(content: string | ContentBlock[]): {
  text: string;
  files: FileInfo[];
} {
  return fromContentBlocks(content, getServerAddress());
}

/** 创建一条待注入插话的灰气泡消息，pendingId 关联服务端缓冲条目，附件载荷沿用 image 字段 JSON 约定 */
const createPendingMessage = (input: PendingInput): ChatMessage => {
  const { text, files } = parseUserContent(input.content);
  return {
    _id: uuidv4(),
    text,
    createdAt: new Date(),
    user: { _id: 1 },
    queued: true,
    pendingId: input.id,
    ...(files.length > 0 ? { image: JSON.stringify(files) } : {}),
  };
};

/**
 * 将一个 step_complete 事件转换为 Thought 数组。
 * 顺序为 thinking → text → tool_use，每个 step 的批次追加到已有 steps 末尾。
 */
function cycleToThoughts(
  content: string | undefined,
  thinking: string | undefined,
  toolCalls?: ToolCall[],
  toolResults?: WsToolResult[]
): Thought[] {
  const thoughts: Thought[] = [];

  if (thinking) {
    thoughts.push({ id: uuidv4(), type: 'thinking', content: thinking });
  }

  if (content) {
    thoughts.push({ id: uuidv4(), type: 'text', content });
  }

  toolCalls?.forEach((tc) => {
    const result = toolResults?.find((r) => r.toolCallId === tc.id);
    thoughts.push({
      id: tc.id,
      type: 'tool_use',
      toolName: tc.name,
      toolInput: tc.arguments,
      toolTitle: tc.toolTitle,
      toolIntent: tc.toolIntent,
      iconUrl: resolveTimelineIconUrl(tc.iconUrl, getServerAddress()),
      toolResult: result
        ? { output: result.result, isError: !result.success }
        : undefined,
    });
  });

  return thoughts;
}

/** 单轮的步骤缓冲，生成期间与界面无关，放在响应式 store 外让步骤到达零渲染 */
interface TurnBuffer {
  thoughts: Thought[];
  content: string;
}

/** 占用快照，context_usage 事件与 meta 种子的载荷，小壳消费一源 */
export interface UsageSnapshot {
  used: number;
  window: number;
}

/**
 * 压缩运行态，压缩行与小壳与顶条共用一源。
 * phase 四态，running 首跑 retry 重试 failed 终态失败 idle 空闲或已终态，
 * lastLanded 持最近一次落定的对比数字，failReason 持失败原因码区分真底线，
 * 两者同受新一轮 run_started 吊销，让位后不复活，
 * failedAt 持失败回执的时间戳，小壳读它亮三秒红色感叹号，新一轮压缩启动时清空。
 */
export interface CompressionRuntimeState {
  recordId: string;
  phase: 'running' | 'retry' | 'failed' | 'idle';
  attempt: number;
  lastLanded: { before: number | null; after: number | null } | null;
  failReason: CompressionFailReason | null;
  failedAt: number | null;
}

/**
 * 压缩记录按发生时间升序，meta 的清单即权威全量。
 */
function sortCompressionRecords(log: CompressionRecord[]): CompressionRecord[] {
  return [...log].sort((a, b) => a.at - b.at);
}

/**
 * 按 recordId 幂等 upsert 一条压缩记录，ws 事件族到达时维护时间线压缩行的数据源。
 * 终态事件找不到对应记录时原样返回，漏收 started 的记录由镜像 meta 初始化兜底。
 * @param records 现有清单
 * @param patch 记录片段，id 必带，其余字段覆盖同 id 记录
 */
function upsertCompressionRecord(
  records: CompressionRecord[],
  patch: Partial<CompressionRecord> & { id: string }
): CompressionRecord[] {
  const index = records.findIndex((r) => r.id === patch.id);
  if (index === -1) {
    return records;
  }
  const next = [...records];
  next[index] = { ...next[index], ...patch };
  return next;
}

/** 单个会话的分片状态 */
interface SessionChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  /** 错过步骤事件的轮次由空缓冲武装，回合结束后从磁盘整包重拉 */
  armedDiskRefresh: boolean;
  /** 陪伴立绘当前姿态 */
  pose: string;
  /** 立绘加载失败标记，姿态切换时清除 */
  poseError: boolean;
}

const createSlice = (): SessionChatState => ({
  messages: EMPTY_MESSAGES,
  status: ChatStatus.Init,
  armedDiskRefresh: false,
  pose: 'default',
  poseError: false,
});

interface ChatStore {
  /** 按 sessionId 分片的会话数据 */
  sessions: Record<string, SessionChatState>;
  /** 当前展示的会话，渲染与加载守卫的唯一依据 */
  displayedSessionId: string;
  /** 会话消息从服务器加载中，驱动空态占位 */
  isLoading: boolean;
  /** 当前 agent 显示名，占位气泡与历史消息转换使用 */
  agentName: string;
  /**
   * 运行中会话的全局集合，run_started 与 run_ended 广播维护，
   * runs_snapshot 整体替换，信号位运行腿与本机 status 取或。
   */
  runningSessions: string[];
  /**
   * 运行归属的内存登记，sessionId 指向 agentId，
   * 只收带归属的运行族事件，旧服务端缺字段时不登记。
   */
  runningOwners: Map<string, string>;
  /** 运行中 Agent 的全局集合，头像运行圈据此起转停转 */
  runningAgents: string[];
  /**
   * 运行期时间线的全局单例，内含 sessionId 归属防串台，
   * ws 单订阅决定同时只有一条活动时间线，顶栏时间线据此渲染活动尾巴。
   */
  liveRun: LiveRunState | null;
  /** 占用快照，context_usage 事件写入，镜像底数种初值，按会话分键不随页面卸载丢 */
  usageSnapshots: Map<string, UsageSnapshot>;
  /** 压缩运行态，小壳压缩中判定与顶条压缩相位与压缩行过程态三处同源读它 */
  compressionStates: Map<string, CompressionRuntimeState>;
  /** 压缩记录清单，镜像 meta 初始化，事件按 recordId 幂等 upsert */
  compressionLogs: Map<string, CompressionRecord[]>;

  /** 切换展示目标会话，需要时从服务器加载，流式进行中则保留现场 */
  activateSession: (sessionId: string) => Promise<void>;
  /** 发送用户消息，附件已达 uploaded 态，空闲走新回合占位链路，忙时进服务端待注入缓冲，失败回滚生成态并提示 */
  sendMessage: (text: string, files: FileInfo[]) => Promise<void>;
  /** 请求服务端中止当前会话的生成 */
  stopGeneration: () => void;
  /** 删除会话分片，会话列表删除时调用 */
  removeSession: (sessionId: string) => void;
  /** 更新当前 agent 显示名 */
  setAgentProfile: (name: string) => void;
  /** 标记会话立绘加载失败 */
  setPoseError: (sessionId: string, value: boolean) => void;
  /** 主机切换后清空全部会话分片与展示态，旧主机的内存现场不再串台 */
  resetForHostSwitch: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},
  displayedSessionId: NEW_CHAT_SESSION,
  isLoading: false,
  runningSessions: [],
  runningOwners: new Map(),
  runningAgents: [],
  agentName: 'AI',
  liveRun: null,
  usageSnapshots: new Map(),
  compressionStates: new Map(),
  compressionLogs: new Map(),

  activateSession: async (sessionId) => {
    if (get().displayedSessionId === sessionId) {
      return;
    }
    const agentId = getServerAgentId();
    saveLastConversation(agentId, sessionId);

    // 新建空白态，直接重置分片
    if (sessionId === NEW_CHAT_SESSION) {
      useChatStore.setState((state) => ({
        sessions: { ...state.sessions, [NEW_CHAT_SESSION]: createSlice() },
        displayedSessionId: NEW_CHAT_SESSION,
      }));
      return;
    }

    logger.info(`${TAG} activate session=${sessionId}`);
    useChatStore.setState({ displayedSessionId: sessionId });

    // 流式进行中的会话保留现场，仅补订阅，不重拉
    if (get().sessions[sessionId]?.status === ChatStatus.Running) {
      wsClient.subscribe(sessionId);
      logger.info(`${TAG} keep live session=${sessionId}`);
      return;
    }

    updateSlice(sessionId, () => createSlice());
    set({ isLoading: true });
    try {
      const address = getServerAddress();
      const view = await loadSessionView(sessionId, agentId, address);
      if (view) {
        lastRefreshedAt[sessionId] = view.updatedAt;
        updateSlice(sessionId, (slice) => ({
          ...slice,
          messages: convertToChatMessages(
            view.messages,
            view.createdAt,
            address
          ),
          pose: view.currentPose ?? 'default',
          poseError: false,
        }));
        seedCompressionData(sessionId, view);
        logger.info(
          `${TAG} session loaded=${sessionId}, messages=${
            view.messages.length
          }, pose=${view.currentPose ?? 'default'}`
        );
      }
      // 加载期间已切走则不抢订阅，避免迟到的加载覆盖新会话的订阅
      if (useChatStore.getState().displayedSessionId === sessionId) {
        wsClient.subscribe(sessionId);
      }
    } catch (e) {
      logger.error(
        `${TAG} loadSession failed: ${
          e instanceof Error ? e.message : e
        }, fallback to chat session`
      );
      if (agentId) {
        useSessionStore
          .getState()
          .setActiveSessionId(chatSessionIdFor(agentId));
      }
    } finally {
      set({ isLoading: false });
    }
  },

  sendMessage: async (text, files) => {
    if (!text && files.length === 0) {
      return;
    }
    const agentId = getServerAgentId();
    const address = getServerAddress();
    if (!agentId || !address) {
      logger.warn(`${TAG} send skipped: no agent or server address`);
      notify.warn('chat.notConnected');
      return;
    }

    const sessionId = get().displayedSessionId;
    // 消息载荷：附件为空保持纯字符串，带附件组装为块数组，只消费上传返回值
    const payload = toContentBlocks(text, files);
    // 纯附件消息的预览取文件名，避免会话列表出现空行
    const previewText = text || files.map((f) => f.fileName).join(' ');

    // 忙时插话：消息进服务端待注入缓冲，灰气泡由 pending_input_changed 广播渲染，失败不上屏无需回滚
    if (sessionId && get().sessions[sessionId]?.status === ChatStatus.Running) {
      useSessionStore
        .getState()
        .updateSessionPreview(sessionId, extractPreview(previewText));
      wsClient.subscribe(sessionId);
      try {
        const result = await sendChatMessage(
          agentId,
          sessionId,
          payload,
          address,
          useVoiceStore.getState().voiceEnabled
        );
        if (result.success) {
          logger.info(
            `${TAG} interjection queued, session=${sessionId} pendingId=${
              result.pendingId ?? 'none'
            } attachments=${files.length}`
          );
        } else {
          logger.warn(
            `${TAG} interjection rejected: ${result.error ?? 'unknown'}`
          );
          notify.error('chat.sendFailed');
        }
      } catch (e) {
        logger.warn(
          `${TAG} interjection failed: ${e instanceof Error ? e.message : e}`
        );
        notify.error('chat.sendFailed');
      }
      return;
    }

    const message: ChatMessage = {
      text,
      user: { _id: 1 },
      createdAt: new Date(),
      _id: uuidv4(),
    };
    if (files.length > 0) {
      message.image = JSON.stringify(files);
    }

    // 乐观追加用户消息并切生成态，助手气泡由 turn_complete 从轮次缓冲组装
    appendUserBubble(sessionId, message);

    try {
      let sid = sessionId;
      if (!sid) {
        logger.debug(`${TAG} send: no server session, auto-creating`);
        sid = await createSession(agentId, address);
        adoptSessionId(sid);
        logger.debug(`${TAG} send: auto-created session ${sid}`);
      }
      logger.debug(
        `${TAG} send: text="${text.substring(
          0,
          80
        )}" sessionId=${sid} attachments=${files.length}`
      );
      // 更新会话列表预览为用户消息
      useSessionStore
        .getState()
        .updateSessionPreview(sid, extractPreview(previewText));
      wsClient.subscribe(sid);
      const voiceEnabled = useVoiceStore.getState().voiceEnabled;
      useVoiceStore.getState().noteChatSent(voiceEnabled, sid);
      const result = await sendChatMessage(
        agentId,
        sid,
        payload,
        address,
        voiceEnabled
      );
      if (!result.success) {
        rollbackGeneratingState(get().displayedSessionId);
        logger.warn(`${TAG} send rejected: ${result.error ?? 'unknown'}`);
        notify.error('chat.sendFailed');
      }
    } catch (e) {
      logger.error(`${TAG} send error: ${e instanceof Error ? e.message : e}`);
      rollbackGeneratingState(get().displayedSessionId);
      notify.error('chat.sendFailed');
    }
  },

  stopGeneration: () => {
    const sid = get().displayedSessionId;
    if (!sid) {
      return;
    }
    wsClient.abort(sid);
    logger.info(`${TAG} abort requested, sid=${sid}`);
  },

  removeSession: (sessionId) => {
    useChatStore.setState((state) => {
      if (!state.sessions[sessionId]) {
        return state;
      }
      const sessions = { ...state.sessions };
      delete sessions[sessionId];
      return { ...state, sessions };
    });
    delete lastRefreshedAt[sessionId];
    logger.info(`${TAG} session removed: ${sessionId}`);
  },

  setAgentProfile: (name) => {
    const next = name || 'AI';
    set({ agentName: next });
    logger.debug(`${TAG} agent profile updated, name=${next}`);
  },

  setPoseError: (sessionId, value) => {
    updateSlice(sessionId, (slice) => ({ ...slice, poseError: value }));
  },

  resetForHostSwitch: () => {
    logger.info(`${TAG} reset for host switch`);
    set({
      sessions: {},
      displayedSessionId: NEW_CHAT_SESSION,
      isLoading: false,
      // 旧主机的运行集合与时间线随现场一并清空，新主机连接后由快照重建
      runningSessions: [],
      runningOwners: new Map(),
      runningAgents: [],
      liveRun: null,
      // 占用与压缩的现场一并清空，新会话激活时从镜像 meta 重新种底数
      usageSnapshots: new Map(),
      compressionStates: new Map(),
      compressionLogs: new Map(),
    });
  },
}));

/** 更新单个会话分片，分片不存在时以初始值创建 */
function updateSlice(
  sessionId: string,
  updater: (slice: SessionChatState) => SessionChatState
): void {
  useChatStore.setState((state) => {
    const prev = state.sessions[sessionId] ?? createSlice();
    return {
      sessions: { ...state.sessions, [sessionId]: updater(prev) },
    };
  });
}

/** 各会话的轮次缓冲，生成期间只写不渲染，步骤到达不触发任何订阅者更新 */
const turnBuffers = new Map<string, TurnBuffer>();

/** 取会话的轮次缓冲，没有则新建空缓冲 */
function getTurnBuffer(sessionId: string): TurnBuffer {
  let buffer = turnBuffers.get(sessionId);
  if (!buffer) {
    buffer = { thoughts: [], content: '' };
    turnBuffers.set(sessionId, buffer);
  }
  return buffer;
}

/**
 * 把轮次缓冲组装成一条助手消息数组，可能为空。
 * - 最终回答的 content 同时存在于缓冲与最后一条 text thought，组装时移除该 thought 避免重复展示
 * - aborted 为 true 时打中止标记，保留已到达的部分内容
 * - 缓冲全空时返回空数组，不产空泡
 */
function assemblePendingBubble(
  buffer: TurnBuffer,
  aborted = false
): ChatMessage[] {
  if (!buffer.content && buffer.thoughts.length === 0) {
    return [];
  }
  const finalThoughts = stripLastTextThought(buffer.thoughts);
  return [
    {
      ...createBotMessage(),
      text: buffer.content,
      steps: finalThoughts.length > 0 ? finalThoughts : undefined,
      aborted: aborted || undefined,
    },
  ];
}

/**
 * 把 step_complete 的思考步骤合并进实时时间线。
 * 本步的思考段与解说文本插到未闭合工具步之前还原先思考后执行的叙述顺序，
 * 未闭合工具步与本次 tool_use 按出现顺序一一配对闭合补全失败态，
 * agent 串行执行保证 tool_started 顺序与 toolCalls 顺序一致，配对不存 stepIndex，
 * tool_started 漏收的 tool_use 补一条已完成步，配对不上的未闭合步按孤儿收尾避免呼吸行悬挂，
 * 文字步带 text 标记落行，渲染时按后面跟不跟工具分中间解说行与回复内容行，
 * 合并即步落行，replying 复位。
 * @param sessionId 事件所属会话，作为时间线归属写回
 * @param liveRun 当前实时状态，null 时惰性创建
 * @param thoughts cycleToThoughts 的产物
 * @returns 合并后的实时状态
 */
function mergeStepIntoLiveRun(
  sessionId: string,
  liveRun: LiveRunState | null,
  thoughts: Thought[]
): LiveRunState {
  const now = Date.now();
  const steps = (liveRun?.steps ?? []).map((s) => ({ ...s }));
  const isOpenTool = (s: LiveStep) => s.tool !== '' && s.endedAt === undefined;

  const thinkSteps: LiveStep[] = [];
  for (const th of thoughts) {
    if ((th.type === 'thinking' || th.type === 'text') && th.content) {
      thinkSteps.push({
        tool: '',
        detail: th.content,
        startedAt: now,
        endedAt: now,
        text: th.type === 'text' || undefined,
      });
    }
  }

  const toolThoughts = thoughts.filter((th) => th.type === 'tool_use');
  const openSteps = steps.filter(isOpenTool);
  const closed: LiveStep[] = [];
  const missed: LiveStep[] = [];
  toolThoughts.forEach((th, i) => {
    const step: LiveStep = {
      tool: th.toolName ?? '',
      detail: summarizeToolInput(th.toolName ?? '', th.toolInput),
      startedAt: openSteps[i]?.startedAt ?? now,
      endedAt: now,
      failed: th.isError || th.toolResult?.isError || undefined,
      // 闭合时以落盘侧的存档文案为准，tool_started 漏收的步从这里补上取值链第一档
      toolTitle: th.toolTitle ?? openSteps[i]?.toolTitle,
      // 图址已随步骤落盘，闭合步优先读落盘侧，活动步的图址兜底
      iconUrl: th.iconUrl ?? openSteps[i]?.iconUrl,
    };
    if (i < openSteps.length) closed.push(step);
    else missed.push(step);
  });
  const orphans = openSteps
    .slice(toolThoughts.length)
    .map((s) => ({ ...s, endedAt: s.endedAt ?? now }));

  const result: LiveStep[] = [];
  let spliced = false;
  for (const s of steps) {
    if (isOpenTool(s)) {
      if (!spliced) {
        result.push(...thinkSteps, ...closed, ...orphans);
        spliced = true;
      }
      continue;
    }
    result.push(s);
  }
  if (!spliced) result.push(...thinkSteps);
  result.push(...missed);
  // 步落行后写作相位结束，下一个信号重新点亮
  return { sessionId, steps: result, replying: false };
}

/** 时间线归属校验后清空，别的会话已接管单例时不动它 */
function clearLiveRunIfOwned(sessionId: string): void {
  const { liveRun } = useChatStore.getState();
  if (liveRun?.sessionId === sessionId) {
    useChatStore.setState({ liveRun: null });
  }
}

/** 时间线归属校验后换空时间线，步骤迁入消息流后蓝条跨轮次间隙不停，回合结束仍走清空 */
function rearmLiveRunIfOwned(sessionId: string): void {
  const { liveRun } = useChatStore.getState();
  if (liveRun?.sessionId === sessionId) {
    useChatStore.setState({
      liveRun: {
        sessionId,
        steps: [],
        replying: liveRun.replying || undefined,
      },
    });
  }
}

/**
 * 切入生成状态并清空轮次缓冲。
 * 发送、订阅恢复与 App 通知触发回合时的公共准备步骤，
 * 生成期间界面无占位气泡，liveRun 同步开空时间线供顶栏时间线驱动。
 * @param sessionId 回合所属会话
 * @param liveSteps 订阅恢复携带的当前动作步骤，常规回合传空
 * @param replying 订阅恢复携带的写作态，常规回合传 false
 */
function enterGeneratingState(
  sessionId: string,
  liveSteps: LiveStep[] = [],
  replying = false
): void {
  turnBuffers.set(sessionId, { thoughts: [], content: '' });
  useChatStore.setState({
    liveRun: { sessionId, steps: liveSteps, replying: replying || undefined },
  });
  updateSlice(sessionId, (slice) => ({
    ...slice,
    status: ChatStatus.Running,
    armedDiskRefresh: false,
  }));
  logger.info(`[live-strip] timeline armed, session=${sessionId}`);
}

/**
 * 追加一条用户气泡并切入生成态。
 * 发送的乐观显示与远端用户消息事件共用，消息体由调用方构造。
 */
function appendUserBubble(sessionId: string, message: ChatMessage): void {
  enterGeneratingState(sessionId);
  updateSlice(sessionId, (slice) => ({
    ...slice,
    messages: GiftedChat.append(slice.messages, [message]),
  }));
}

/**
 * 发送失败的现场回滚：结束生成态与顶栏时间线，乐观用户消息保留作已发凭证，与桌面端行为对齐。
 * @param sessionId 回滚目标分片，新会话转正前后都取当时的展示身份
 */
function rollbackGeneratingState(sessionId: string): void {
  if (!sessionId) {
    return;
  }
  const { liveRun } = useChatStore.getState();
  if (liveRun?.sessionId === sessionId) {
    useChatStore.setState({ liveRun: null });
  }
  updateSlice(sessionId, (slice) => ({
    ...slice,
    status: ChatStatus.Complete,
  }));
  logger.info(`${TAG} generating rolled back, session=${sessionId}`);
}

/**
 * 会话拿到真实 ID 后迁移展示身份：
 * - 把新建态分片从 NEW_CHAT_SESSION 迁移到真实 sessionId
 * - 持久化到 MMKV 供冷启动恢复
 * - 同步 sessionStore.activeSessionId，外层加载守卫据此跳过重复加载
 */
function adoptSessionId(sessionId: string): void {
  useChatStore.setState((state) => {
    if (state.displayedSessionId === sessionId) {
      return state;
    }
    const sessions = { ...state.sessions };
    const draft = sessions[NEW_CHAT_SESSION];
    if (draft) {
      sessions[sessionId] = draft;
      delete sessions[NEW_CHAT_SESSION];
    }
    return { ...state, sessions, displayedSessionId: sessionId };
  });
  saveLastConversation(getServerAgentId(), sessionId);
  useSessionStore.getState().setActiveSessionId(sessionId);
}

/**
 * 读取会话的渲染视图，镜像优先，镜像未命中走网络兜底。
 * 两条路径产出同形数据，convertToChatMessages 无感知数据来源。
 */
async function loadSessionView(
  sessionId: string,
  agentId: string,
  address: string
): Promise<{
  updatedAt: number;
  createdAt: number;
  currentPose?: string;
  messages: ServerChatMessage[];
  compressionLog?: CompressionRecord[];
  usageState?: UsageState;
} | null> {
  const mirrored = await cacheDb.getSession(sessionId);
  if (mirrored) {
    return {
      updatedAt: mirrored.updatedAt,
      createdAt: mirrored.createdAt,
      currentPose: mirrored.currentPose,
      messages: toServerChatMessages(mirrored.messages),
      compressionLog: mirrored.compressionLog,
      usageState: mirrored.usageState,
    };
  }
  const session = await fetchSessionMessages(address, agentId, sessionId);
  return {
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    currentPose: session.currentPose,
    messages: session.messages,
    compressionLog: session.compressionLog,
    usageState: session.usageState,
  };
}

/**
 * 会话视图的压缩记录与占用底数落进全局层。
 * 压缩记录按 meta 权威清单覆盖，占用快照只在尚无真实快照时种底数，
 * 底数无窗口字段，种下的快照 window 记零维持图标壳，数字等订阅补推的真实事件。
 */
function seedCompressionData(
  sessionId: string,
  view: { compressionLog?: CompressionRecord[]; usageState?: UsageState }
): void {
  const logs = new Map(useChatStore.getState().compressionLogs);
  logs.set(sessionId, sortCompressionRecords(view.compressionLog ?? []));
  const snapshots = new Map(useChatStore.getState().usageSnapshots);
  if (!snapshots.get(sessionId)?.window && view.usageState) {
    snapshots.set(sessionId, {
      used: view.usageState.base ?? 0,
      window: 0,
    });
  }
  useChatStore.setState({ compressionLogs: logs, usageSnapshots: snapshots });
}

/** 各会话最近一次落盘刷新时的 updatedAt，相同值跳过重扫 */
const lastRefreshedAt: Record<string, number> = {};

/**
 * 从本地重读指定会话的消息列表。
 * 武装刷新与追平补拉场景使用，扫描规则保证渲染顺序与实时链路一致。
 * 入口先做更新时间预检查，会话无变化且本地已有消息时零成本返回。
 * 会话档案携带 currentPose 时同步回填立绘表情，漏事件后立绘由此追平。
 */
async function refreshFromDisk(sessionId: string): Promise<void> {
  if (!sessionId) {
    return;
  }
  const agentId = getServerAgentId();
  const address = getServerAddress();
  if (!agentId) {
    return;
  }
  try {
    // 廉价预检查，更新时间未变且本地已有消息时直接返回，追平信号触发但会话无变化时零开销
    const current = useChatStore.getState().sessions[sessionId];
    if (current && current.messages.length > 0) {
      const updatedAt = await cacheDb.getSessionUpdatedAt(sessionId);
      if (updatedAt !== null && updatedAt === lastRefreshedAt[sessionId]) {
        logger.debug(`${TAG} refresh skipped, session=${sessionId} unchanged`);
        return;
      }
    }
    const view = await loadSessionView(sessionId, agentId, address);
    if (!view) {
      return;
    }
    const slice = useChatStore.getState().sessions[sessionId];
    if (
      slice &&
      slice.messages.length > 0 &&
      lastRefreshedAt[sessionId] === view.updatedAt
    ) {
      return;
    }
    lastRefreshedAt[sessionId] = view.updatedAt;
    updateSlice(sessionId, (prev) => ({
      ...prev,
      messages: convertToChatMessages(view.messages, view.createdAt, address),
      pose: view.currentPose ?? prev.pose,
      poseError: view.currentPose ? false : prev.poseError,
    }));
    if (view.currentPose) {
      logger.debug(
        `${TAG} pose backfilled from disk, session=${sessionId} pose=${view.currentPose}`
      );
    }
    // 追平补拉同时收敛压缩记录，离线期间的记录由镜像 meta 兜底带回
    seedCompressionData(sessionId, view);
    logger.info(`${TAG} messages refreshed from disk, session=${sessionId}`);
  } catch (e) {
    logger.error(`${TAG} refresh from disk failed: ${e}`);
  }
}

/**
 * 回合结束的公共收尾：
 * - 状态回到 Init 并清空轮次缓冲与武装标志，归属本会话的时间线一并兜底清空
 * - 消息数大于一（用户消息加回复）时通知会话列表刷新预览
 */
function finishTurn(sessionId: string): void {
  turnBuffers.delete(sessionId);
  clearLiveRunIfOwned(sessionId);
  updateSlice(sessionId, (slice) => ({
    ...slice,
    status: ChatStatus.Init,
    armedDiskRefresh: false,
  }));
  const slice = useChatStore.getState().sessions[sessionId];
  if (slice && slice.messages.length > 1) {
    useSessionStore.getState().requestHomeRefresh();
  }
}

/**
 * 注册 ws-client 事件处理器，模块加载时执行一次永不注销。
 * 事件按消息携带的 sessionId 写入对应分片，title_updated 由 ws-client 直接写 sessionStore。
 */
function registerWsHandler(): void {
  wsClient.registerHandler({
    onToolStarted: (
      sessionId,
      _stepIndex,
      toolName,
      paramSummary,
      toolTitle,
      iconUrl
    ) => {
      const state = useChatStore.getState();
      const slice = state.sessions[sessionId];
      // 迟到守卫：回合未在进行中即丢弃，不污染空闲时间线
      if (slice?.status !== ChatStatus.Running) {
        logger.info(
          `[live-strip] late tool_started ignored, session=${sessionId}`
        );
        return;
      }
      // 单例归属校验：归属不符先对齐归属再开步，ws 单订阅下这是防御位
      const prev =
        state.liveRun?.sessionId === sessionId ? state.liveRun : null;
      useChatStore.setState({
        liveRun: {
          sessionId,
          steps: [
            ...(prev?.steps ?? []),
            {
              tool: toolName,
              detail: paramSummary,
              toolTitle,
              iconUrl: resolveTimelineIconUrl(iconUrl, getServerAddress()),
              startedAt: Date.now(),
            },
          ],
          // 同步内先写正文后接工具时保住写作标志，步落行时统一复位
          replying: prev?.replying,
        },
      });
      logger.info(
        `[live-strip] tool started, session=${sessionId} tool=${toolName} icon=${
          iconUrl ?? 'none'
        }`
      );
    },
    onContentStarted: (sessionId, stepIndex) => {
      const state = useChatStore.getState();
      const slice = state.sessions[sessionId];
      // 迟到守卫：回合未在进行中即丢弃，不污染空闲时间线
      if (slice?.status !== ChatStatus.Running) {
        logger.info(
          `[live-strip] late content_started ignored, session=${sessionId}`
        );
        return;
      }
      // 只报开始的轻量信号，正文不直播，步末随 step_complete 整段落行
      const prev =
        state.liveRun?.sessionId === sessionId ? state.liveRun : null;
      useChatStore.setState({
        liveRun: {
          sessionId,
          steps: prev ? [...prev.steps] : [],
          replying: true,
        },
      });
      logger.info(
        `[live-strip] content started, session=${sessionId} step=${stepIndex}`
      );
    },
    onStepComplete: (sessionId, content, thinking, toolCalls, toolResults) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        logger.warn(`${TAG} step_complete for unknown session: ${sessionId}`);
        return;
      }
      // 非运行态的迟到步骤直接丢弃，不污染下一轮缓冲
      if (slice.status !== ChatStatus.Running) {
        logger.info(`${TAG} late step_complete ignored`);
        return;
      }
      const newThoughts = cycleToThoughts(
        content,
        thinking,
        toolCalls,
        toolResults
      );
      // 步骤只进 store 外的轮次缓冲，界面无中间助手内容，也不触发订阅者渲染
      const buffer = getTurnBuffer(sessionId);
      buffer.thoughts.push(...newThoughts);
      buffer.content = content || buffer.content;
      // 同步推进时间线显示层，只进 liveRun 不动轮次缓冲与气泡组装
      const { liveRun } = useChatStore.getState();
      const merged = mergeStepIntoLiveRun(
        sessionId,
        liveRun?.sessionId === sessionId ? liveRun : null,
        newThoughts
      );
      useChatStore.setState({ liveRun: merged });
      logger.info(
        `[live-strip] step merged, session=${sessionId} timelineSteps=${merged.steps.length}`
      );
      logger.debug(
        `${TAG} step buffered, session=${sessionId} thoughts=${
          buffer.thoughts.length
        } contentLen=${content?.length ?? 0}`
      );

      // 检测 show_pose 指令，切换陪伴立绘，广播名为注册全名，归一化与成功判定收敛在 successfulPose
      const pose = successfulPose(toolCalls, toolResults);
      if (pose) {
        logger.debug(`${TAG} pose change: ${pose}`);
        updateSlice(sessionId, (prev) => ({
          ...prev,
          pose,
          poseError: false,
        }));
      }

      // 工具执行失败时记录日志
      if (toolResults && toolResults.length > 0) {
        const failed = toolResults.filter((tr) => !tr.success);
        if (failed.length > 0) {
          logger.warn(
            `${TAG} tool failures: ${failed
              .map((tr) => `${tr.toolName}(${tr.result.substring(0, 60)})`)
              .join(', ')}`
          );
        }
      }
    },
    onTurnComplete: (sessionId) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        return;
      }
      const bubble = assemblePendingBubble(getTurnBuffer(sessionId));
      // 空缓冲说明重连或恢复错过了本轮步骤事件，武装刷新标志，回合结束后从磁盘整包重拉
      if (bubble.length === 0) {
        updateSlice(sessionId, (prev) => ({
          ...prev,
          armedDiskRefresh: true,
        }));
        rearmLiveRunIfOwned(sessionId);
        logger.info(`${TAG} turn end with empty buffer, disk refresh armed`);
        return;
      }
      // 组装整轮气泡追加到末尾，追加天然形成聊天顺序，插话灰气泡排在整轮之上
      updateSlice(sessionId, (prev) => ({
        ...prev,
        messages: GiftedChat.append(prev.messages, bubble),
      }));
      // 会话列表预览在轮末一次到位，步骤期间不再逐条更新
      useSessionStore
        .getState()
        .updateSessionPreview(sessionId, extractPreview(bubble[0].text));
      // 时间线步骤随组装迁入消息流，liveRun 换空时间线保持运动态跨过轮次间隙
      rearmLiveRunIfOwned(sessionId);
      logger.info(
        `${TAG} turn bubble assembled, session=${sessionId} contentLen=${bubble[0].text.length}`
      );
    },
    onComplete: (sessionId) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        return;
      }
      const needsRefresh = slice.armedDiskRefresh;
      finishTurn(sessionId);
      if (needsRefresh) {
        refreshFromDisk(sessionId);
        logger.info(`${TAG} round complete, refreshed from disk`);
        return;
      }
      trigger(HapticFeedbackTypes.notificationSuccess);
      logger.info(`${TAG} round complete`);
    },
    onError: (sessionId, message) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        return;
      }
      // 缓冲冲刷成半截气泡再追加错误气泡，与刷新链路的 error 结组口径一致
      const flushed = assemblePendingBubble(getTurnBuffer(sessionId));
      const errorBubble: ChatMessage = {
        ...createBotMessage(),
        text: i18n.t('chat.error', { message }),
        error: true,
      };
      updateSlice(sessionId, (prev) => ({
        ...prev,
        messages: GiftedChat.append(prev.messages, [errorBubble, ...flushed]),
      }));
      finishTurn(sessionId);
      logger.info(`${TAG} turn errored, partial flushed`);
    },
    onAborted: (sessionId) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        return;
      }
      // 缓冲冲刷成带中止标记的半截气泡保留部分内容，空缓冲不产泡
      const flushed = assemblePendingBubble(getTurnBuffer(sessionId), true);
      if (flushed.length > 0) {
        updateSlice(sessionId, (prev) => ({
          ...prev,
          messages: GiftedChat.append(prev.messages, flushed),
        }));
      }
      finishTurn(sessionId);
      logger.info(`${TAG} turn aborted, partial kept`);
    },
    onSpeakReady: (sessionId, data) => {
      if (sessionId !== useSessionStore.getState().activeSessionId) {
        logger.info(`${TAG} speak_ready ignored: session not active`);
        // 用户已切走会话，等待动画无处落地，收掉避免点亮后悬空
        useVoiceStore.getState().clearSpeakStage();
        return;
      }
      if (data.initiatorDeviceId && data.initiatorDeviceId !== getDeviceId()) {
        logger.info(`${TAG} speak_ready ignored: initiated by another device`);
        return;
      }
      const voice = useVoiceStore.getState();
      if (!voice.voiceEnabled) {
        logger.info(`${TAG} speak_ready ignored: voice disabled`);
        return;
      }
      logger.info(
        `${TAG} speak_ready, session=${sessionId} textLen=${data.speakText.length}`
      );
      voice.speak(data);
    },
    onSpeakError: (_sessionId, reason, message, initiatorDeviceId) => {
      if (initiatorDeviceId && initiatorDeviceId !== getDeviceId()) {
        logger.info(`${TAG} speak_error ignored: initiated by another device`);
        return;
      }
      logger.error(`${TAG} speak_error: ${message}`);
      useVoiceStore.getState().noteSpeakError(reason);
    },
    onSubscribed: (sessionId, isGenerating, activity) => {
      if (!isGenerating) {
        return;
      }
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        return;
      }
      // 只增不减：已在 Running 则跳过，避免与 sendMessage 冲突
      if (slice.status === ChatStatus.Running) {
        return;
      }
      // tool 态当前动作直接开活动工具步，replying 态置写作标志，中途接入立即显示对应相位
      const liveSteps: LiveStep[] =
        activity?.kind === 'tool'
          ? [
              {
                tool: activity.toolName,
                detail: activity.paramSummary,
                startedAt: Date.now(),
              },
            ]
          : [];
      enterGeneratingState(sessionId, liveSteps, activity?.kind === 'replying');
      logger.info(
        `[live-strip] generating restored, session=${sessionId} activity=${
          activity?.kind ?? 'thinking'
        }`
      );
    },
    onRunStarted: (sessionId, agentId) => {
      // 幂等添加，广播重放或快照竞态不产生重复成员；旧服务端缺归属时只维护会话集合
      const { runningSessions, runningOwners, compressionStates } =
        useChatStore.getState();
      const patch: Partial<ChatStore> = {
        runningSessions: runningSessions.includes(sessionId)
          ? runningSessions
          : [...runningSessions, sessionId],
      };
      if (agentId) {
        const owners = new Map(runningOwners).set(sessionId, agentId);
        patch.runningOwners = owners;
        patch.runningAgents = [...new Set(owners.values())];
      }
      // 顶条闸门：模型新一轮运行吊销压缩落定显示，成功失败一并清空，让位后不复活
      const comp = compressionStates.get(sessionId);
      if (comp?.lastLanded || comp?.phase === 'failed') {
        patch.compressionStates = new Map(compressionStates).set(sessionId, {
          ...comp,
          phase: 'idle',
          lastLanded: null,
          failReason: null,
        });
      }
      useChatStore.setState(patch);
      logger.info(
        `${TAG} run set added: ${sessionId} agent=${agentId ?? 'unknown'}`
      );
    },
    onRunEnded: (sessionId) => {
      const { runningSessions, runningOwners } = useChatStore.getState();
      // 归属登记一并摘除，同 Agent 还有会话在跑时派生集合自然保留
      const owners = new Map(runningOwners);
      owners.delete(sessionId);
      useChatStore.setState({
        runningSessions: runningSessions.filter((id) => id !== sessionId),
        runningOwners: owners,
        runningAgents: [...new Set(owners.values())],
      });
      logger.info(`${TAG} run set removed: ${sessionId}`);
      useVoiceStore.getState().noteRoundEnded(sessionId);
    },
    onRunsSnapshot: (sessionIds, runs) => {
      // 快照整体替换，晚接入与重连端据此对齐 server 运行全量；旧服务端无归属条目时 Agent 集合置空不误转
      const owners = new Map(
        (runs ?? []).map((run) => [run.sessionId, run.agentId])
      );
      const runningAgents = [...new Set(owners.values())];
      useChatStore.setState({
        runningSessions: sessionIds,
        runningOwners: owners,
        runningAgents,
      });
      logger.info(
        `${TAG} run set replaced, count=${sessionIds.length} agents=${runningAgents.length}`
      );
    },
    onAppNotification: (sessionId, source, content) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        logger.info(
          `${TAG} app_notification ignored, unknown session: ${sessionId}`
        );
        return;
      }
      // 双重防御：已在 Running 说明生成态已存在，sendMessage 与 onSubscribed 先到
      if (slice.status === ChatStatus.Running) {
        logger.info(`${TAG} app_notification ignored, already running`);
        return;
      }
      enterGeneratingState(sessionId);
      logger.info(
        `${TAG} app_notification turn started, source=${source} content=${content.substring(
          0,
          60
        )}`
      );
    },
    onUserMessage: (sessionId, content) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        logger.debug(
          `${TAG} user_message ignored, unknown session: ${sessionId}`
        );
        return;
      }
      // 回声识别，发起端已乐观追加并进入生成态，自己的广播直接跳过
      if (slice.status === ChatStatus.Running) {
        logger.debug(`${TAG} user_message echo skipped, session=${sessionId}`);
        return;
      }
      // 块数组载荷解析出正文与附件，远端用户气泡与乐观消息同形
      const { text, files } = parseUserContent(content);
      appendUserBubble(sessionId, {
        text,
        user: { _id: 1 },
        createdAt: new Date(),
        _id: uuidv4(),
        ...(files.length > 0 ? { image: JSON.stringify(files) } : {}),
      });
      useSessionStore
        .getState()
        .updateSessionPreview(sessionId, extractPreview(text));
      logger.info(
        `${TAG} user_message appended, session=${sessionId} contentLen=${text.length} attachments=${files.length}`
      );
    },
    onPendingChanged: (sessionId, pending) => {
      const slice = useChatStore.getState().sessions[sessionId];
      if (!slice) {
        logger.warn(
          `${TAG} pending_input_changed for unknown session: ${sessionId}`
        );
        return;
      }
      // 全量同步：不在服务端列表的 pendingId 已注入，灰气泡转正常，未知条目补灰气泡
      updateSlice(sessionId, (prev) => {
        const pendingIds = new Set(pending.map((p) => p.id));
        const messages = prev.messages.map((m) =>
          m.queued && m.pendingId && !pendingIds.has(m.pendingId)
            ? { ...m, queued: false }
            : m
        );
        const localPendingIds = new Set(
          messages.filter((m) => m.pendingId).map((m) => m.pendingId as string)
        );
        // app 来源的通知不进聊天窗，只处理用户插话
        const additions = pending
          .filter((p) => !localPendingIds.has(p.id) && p.source !== 'app')
          .map((p) => createPendingMessage(p));
        return { ...prev, messages: GiftedChat.append(messages, additions) };
      });
      logger.info(
        `${TAG} pending synced, session=${sessionId} count=${pending.length}`
      );
    },
    onContextUsage: (sessionId, snapshot) => {
      useChatStore.setState((state) => {
        const snapshots = new Map(state.usageSnapshots);
        snapshots.set(sessionId, snapshot);
        return { usageSnapshots: snapshots };
      });
      logger.info(
        `${TAG} usage snapshot, session=${sessionId} used=${snapshot.used} window=${snapshot.window}`
      );
    },
    onCompressionStarted: (sessionId, recordId, attempt, before) => {
      useChatStore.setState((state) => {
        const states = new Map(state.compressionStates);
        // 过程态重置，上一轮落定显示清空，attempt 递增转重试相位
        states.set(sessionId, {
          recordId,
          phase: attempt > 1 ? 'retry' : 'running',
          attempt,
          lastLanded: null,
          failReason: null,
          failedAt: null,
        });
        const logs = new Map(state.compressionLogs);
        const current = logs.get(sessionId) ?? [];
        if (current.some((r) => r.id === recordId)) {
          logs.set(
            sessionId,
            upsertCompressionRecord(current, {
              id: recordId,
              state: 'running',
              attempt,
              before,
              after: null,
            })
          );
        } else {
          // started 事件不带 trigger，合成记录占 manual，运行态渲染不读它，落定事件补齐真实值
          logs.set(
            sessionId,
            sortCompressionRecords([
              ...current,
              {
                id: recordId,
                state: 'running',
                trigger: 'manual',
                attempt,
                before,
                after: null,
                at: Date.now(),
              },
            ])
          );
        }
        return { compressionStates: states, compressionLogs: logs };
      });
      logger.info(
        `${TAG} compression started, session=${sessionId} record=${recordId} attempt=${attempt}`
      );
    },
    onCompressionComplete: (
      sessionId,
      recordId,
      before,
      after,
      triggerKind
    ) => {
      useChatStore.setState((state) => {
        const prev = state.compressionStates.get(sessionId);
        // recordId 对不上说明是陈旧事件，不覆盖新一轮状态
        if (prev && prev.recordId !== recordId) return {};
        const states = new Map(state.compressionStates);
        states.set(sessionId, {
          recordId,
          phase: 'idle',
          attempt: prev?.attempt ?? 1,
          lastLanded: { before, after },
          failReason: null,
          failedAt: null,
        });
        const logs = new Map(state.compressionLogs);
        logs.set(
          sessionId,
          upsertCompressionRecord(logs.get(sessionId) ?? [], {
            id: recordId,
            state: 'complete',
            trigger: triggerKind,
            before,
            after,
          })
        );
        return { compressionStates: states, compressionLogs: logs };
      });
      logger.info(
        `${TAG} compression complete, session=${sessionId} record=${recordId} before=${
          before ?? 'none'
        } after=${after ?? 'none'}`
      );
    },
    onCompressionFailed: (sessionId, recordId, reason) => {
      useChatStore.setState((state) => {
        const prev = state.compressionStates.get(sessionId);
        // 陈旧守护只拦压缩进行中的陌生编号，无 started 领路的连发失败带新编号照常受理
        if (
          prev &&
          (prev.phase === 'running' || prev.phase === 'retry') &&
          prev.recordId !== recordId
        ) {
          return {};
        }
        const states = new Map(state.compressionStates);
        // 终态失败落 failed 相位带时间戳与原因码，顶条读它亮红字，小壳读时间戳亮三秒红色感叹号
        states.set(sessionId, {
          recordId,
          phase: 'failed',
          attempt: prev?.attempt ?? 1,
          lastLanded: null,
          failReason: reason,
          failedAt: Date.now(),
        });
        // 事件族失败一律落 failed 态带原因码，interrupted 态只来自服务端崩溃恢复的 meta
        const logs = new Map(state.compressionLogs);
        logs.set(
          sessionId,
          upsertCompressionRecord(logs.get(sessionId) ?? [], {
            id: recordId,
            state: 'failed',
            reason,
          })
        );
        return { compressionStates: states, compressionLogs: logs };
      });
      logger.warn(
        `${TAG} compression failed, session=${sessionId} record=${recordId} reason=${reason}`
      );
    },
  });
}

registerWsHandler();

/** 监听追平完成计数，重连或冷启动追平后空闲的当前会话补拉一次，运行中的交给轮次机制收敛 */
let lastCatchUpVersion = 0;
useMirrorStore.subscribe((state) => {
  if (state.catchUpVersion === lastCatchUpVersion) {
    return;
  }
  lastCatchUpVersion = state.catchUpVersion;
  const sid = useChatStore.getState().displayedSessionId;
  if (!sid || sid === NEW_CHAT_SESSION) {
    return;
  }
  if (useChatStore.getState().sessions[sid]?.status === ChatStatus.Running) {
    logger.info(`${TAG} catch-up done, running session kept live`);
    return;
  }
  logger.info(`${TAG} catch-up done, refreshing messages`);
  refreshFromDisk(sid);
});
