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
  getAgentAvatarUrl,
  fetchSessionMessages,
  convertToChatMessages,
  chatSessionIdFor,
  type PendingInput,
  type ServerChatMessage,
} from '../api/server-api.ts';
import {
  getServerAddress,
  getServerAgentId,
  saveLastConversation,
} from '../storage/StorageUtils.ts';
import { cacheDb } from '../storage/cache-db.ts';
import { toServerChatMessages } from '../storage/sync-shapes.ts';
import { useMirrorStore } from '../stores/mirrorStore.ts';
import { getFileTypeSummary, isAllFileReady } from '../chat/util/FileUtils.ts';
import {
  cycleToThoughts,
  stripLastTextThought,
} from '../chat/util/thought-utils';
import {
  useSessionStore,
  extractPreview,
  NEW_CHAT_SESSION,
} from './sessionStore.ts';
import { useVoiceStore } from './voiceStore.ts';
import { trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types';
import { logger } from '../lib/logger';
import i18n from '../i18n/index';
import type { ChatMessage, FileInfo } from '../types/Chat.ts';
import type { Thought } from '../types/Thought';
import { ChatStatus } from '../types/Chat.ts';

const TAG = '[ChatStore]';

export const BOT_ID = 2;
export const textPlaceholder = '...';
/** 空消息数组的模块级常量，避免组件内兜底取值每次产生新引用引发多余渲染 */
export const EMPTY_MESSAGES: ChatMessage[] = [];

/** 创建一条 AI 气泡消息，轮次组装与错误提示的公共构造 */
const createBotMessage = (agentName: string, avatar: string): ChatMessage => ({
  _id: uuidv4(),
  text: textPlaceholder,
  createdAt: new Date(),
  user: { _id: BOT_ID, name: agentName, avatar },
  steps: [],
});

/** 创建一条待注入插话的灰气泡消息，pendingId 关联服务端缓冲条目 */
const createPendingMessage = (input: PendingInput): ChatMessage => ({
  _id: uuidv4(),
  text: input.content,
  createdAt: new Date(),
  user: { _id: 1 },
  queued: true,
  pendingId: input.id,
});

/** 单轮的步骤缓冲，生成期间与界面无关，放在响应式 store 外让步骤到达零渲染 */
interface TurnBuffer {
  thoughts: Thought[];
  content: string;
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

  /** 切换展示目标会话，需要时从服务器加载，流式进行中则保留现场 */
  activateSession: (sessionId: string) => Promise<void>;
  /** 发送用户消息，空闲走新回合占位链路，忙时进服务端待注入缓冲 */
  sendMessage: (text: string, files: FileInfo[]) => Promise<void>;
  /** 请求服务端中止当前会话的生成 */
  stopGeneration: () => void;
  /** 删除会话分片，会话列表删除时调用 */
  removeSession: (sessionId: string) => void;
  /** 更新当前 agent 显示名 */
  setAgentProfile: (name: string) => void;
  /** 标记会话立绘加载失败 */
  setPoseError: (sessionId: string, value: boolean) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},
  displayedSessionId: NEW_CHAT_SESSION,
  isLoading: false,
  agentName: 'AI',

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
            get().agentName,
            getAgentAvatarUrl(agentId, address)
          ),
          pose: view.currentPose ?? 'default',
          poseError: false,
        }));
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
    if (!isAllFileReady(files)) {
      return;
    }
    const agentId = getServerAgentId();
    const address = getServerAddress();
    if (!agentId || !address) {
      logger.warn(`${TAG} send skipped: no agent or server address`);
      return;
    }

    const sessionId = get().displayedSessionId;
    const messageText = text || getFileTypeSummary(files);

    // 忙时插话：消息进服务端待注入缓冲，灰气泡由 pending_input_changed 广播渲染，失败不上屏无需回滚
    if (sessionId && get().sessions[sessionId]?.status === ChatStatus.Running) {
      useSessionStore
        .getState()
        .updateSessionPreview(sessionId, extractPreview(messageText));
      wsClient.subscribe(sessionId);
      try {
        const result = await sendChatMessage(
          agentId,
          sessionId,
          messageText,
          address,
          useVoiceStore.getState().voiceEnabled
        );
        logger.info(
          `${TAG} interjection queued, session=${sessionId} pendingId=${
            result.pendingId ?? 'none'
          }`
        );
      } catch (e) {
        logger.warn(
          `${TAG} interjection failed: ${e instanceof Error ? e.message : e}`
        );
      }
      return;
    }

    const message: ChatMessage = {
      text: messageText,
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
        `${TAG} send: text="${messageText.substring(0, 80)}" sessionId=${sid}`
      );
      // 更新会话列表预览为用户消息
      useSessionStore
        .getState()
        .updateSessionPreview(sid, extractPreview(messageText));
      wsClient.subscribe(sid);
      await sendChatMessage(
        agentId,
        sid,
        messageText,
        address,
        useVoiceStore.getState().voiceEnabled
      );
    } catch (e) {
      logger.error(`${TAG} send error: ${e instanceof Error ? e.message : e}`);
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
    set({ agentName: name || 'AI' });
  },

  setPoseError: (sessionId, value) => {
    updateSlice(sessionId, (slice) => ({ ...slice, poseError: value }));
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
      ...createBotMessage(
        useChatStore.getState().agentName,
        getAgentAvatarUrl(getServerAgentId(), getServerAddress())
      ),
      text: buffer.content,
      steps: finalThoughts.length > 0 ? finalThoughts : undefined,
      aborted: aborted || undefined,
    },
  ];
}

/**
 * 切入生成状态并清空轮次缓冲。
 * 发送、订阅恢复与 App 通知触发回合时的公共准备步骤，
 * 生成期间界面无占位气泡，运行指示由头部小点承担。
 */
function enterGeneratingState(sessionId: string): void {
  turnBuffers.set(sessionId, { thoughts: [], content: '' });
  updateSlice(sessionId, (slice) => ({
    ...slice,
    status: ChatStatus.Running,
    armedDiskRefresh: false,
  }));
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
} | null> {
  const mirrored = await cacheDb.getSession(sessionId);
  if (mirrored) {
    return {
      updatedAt: mirrored.updatedAt,
      createdAt: mirrored.createdAt,
      currentPose: mirrored.currentPose,
      messages: toServerChatMessages(mirrored.messages),
    };
  }
  const session = await fetchSessionMessages(address, agentId, sessionId);
  return {
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    currentPose: session.currentPose,
    messages: session.messages,
  };
}

/** 各会话最近一次落盘刷新时的 updatedAt，相同值跳过重扫 */
const lastRefreshedAt: Record<string, number> = {};

/**
 * 从本地重读指定会话的消息列表。
 * 武装刷新与追平补拉场景使用，扫描规则保证渲染顺序与实时链路一致。
 * 入口先做更新时间预检查，会话无变化且本地已有消息时零成本返回。
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
      messages: convertToChatMessages(
        view.messages,
        view.createdAt,
        useChatStore.getState().agentName,
        getAgentAvatarUrl(agentId, address)
      ),
    }));
    logger.info(`${TAG} messages refreshed from disk, session=${sessionId}`);
  } catch (e) {
    logger.error(`${TAG} refresh from disk failed: ${e}`);
  }
}

/**
 * 回合结束的公共收尾：
 * - 状态回到 Init 并清空轮次缓冲与武装标志
 * - 消息数大于一（用户消息加回复）时通知会话列表刷新预览
 */
function finishTurn(sessionId: string): void {
  turnBuffers.delete(sessionId);
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
      logger.debug(
        `${TAG} step buffered, session=${sessionId} thoughts=${
          buffer.thoughts.length
        } contentLen=${content?.length ?? 0}`
      );

      // 检测 show_pose 指令，切换陪伴立绘
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          if (tc.name === 'show_pose' && tc.arguments) {
            const pose = tc.arguments.pose as string;
            const result = toolResults?.find((tr) => tr.toolCallId === tc.id);
            if (pose && result?.success) {
              logger.debug(`${TAG} pose change: ${pose}`);
              updateSlice(sessionId, (prev) => ({
                ...prev,
                pose,
                poseError: false,
              }));
            }
          }
        }
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
        ...createBotMessage(
          useChatStore.getState().agentName,
          getAgentAvatarUrl(getServerAgentId(), getServerAddress())
        ),
        text: i18n.t('chat.error', { message }),
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
    onSpeakError: (_sessionId, _reason, message) => {
      logger.error(`${TAG} speak_error: ${message}`);
    },
    onSubscribed: (sessionId, isGenerating) => {
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
      enterGeneratingState(sessionId);
      logger.info(`${TAG} session is generating, loading state entered`);
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
      appendUserBubble(sessionId, {
        text: content,
        user: { _id: 1 },
        createdAt: new Date(),
        _id: uuidv4(),
      });
      useSessionStore
        .getState()
        .updateSessionPreview(sessionId, extractPreview(content));
      logger.info(
        `${TAG} user_message appended, session=${sessionId} contentLen=${content.length}`
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
