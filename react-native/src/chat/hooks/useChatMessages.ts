/**
 * @file hooks/useChatMessages.ts
 * @description 聊天消息核心逻辑：消息状态管理、WS 事件处理器注册、消息发送。
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { GiftedChat } from 'react-native-gifted-chat';
import uuid from 'uuid';
import * as wsClient from '../../api/ws-client';
import {
  createSession,
  sendChatMessage,
  getAgentAvatarUrl,
  fetchSessionMessages,
  convertToChatMessages,
} from '../../api/server-api';
import type { ToolCall, WsToolResult } from '../../api/server-api';
import {
  getServerAgentId,
  saveLastSessionId,
} from '../../storage/StorageUtils';
import { getFileTypeSummary, isAllFileReady } from '../util/FileUtils';
import { cycleToThoughts, stripLastTextThought } from '../util/thought-utils';
import { useSessionStore, extractPreview } from '../../stores/sessionStore';
import { trigger } from '../util/HapticUtils';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types';
import { logger } from '../../lib/logger';
import i18n from '../../i18n/index';
import type { ChatMessage, FileInfo } from '../../types/Chat';
import { ChatStatus } from '../../types/Chat';

export const BOT_ID = 2;
export const textPlaceholder = '...';

/** 创建一条 AI 占位消息，在流式回复开始前插入消息列表 */
const createBotMessage = (agentName: string, avatar: string): ChatMessage => ({
  _id: uuid.v4() as string,
  text: textPlaceholder,
  createdAt: new Date(),
  user: { _id: BOT_ID, name: agentName, avatar },
  steps: [],
});

interface UseChatMessagesParams {
  scrollToBottom: () => void;
  setUserScrolled: (v: boolean) => void;
  serverAddressRef: React.MutableRefObject<string>;
  currentAgentNameRef: React.MutableRefObject<string>;
  voiceEnabledRef: React.MutableRefObject<boolean>;
  speakRef: React.MutableRefObject<
    (data: {
      speakText: string;
      voiceId: string;
      apiKey: string;
      model: string;
      languageBoost?: string;
    }) => Promise<void>
  >;
  selectedFilesRef: React.MutableRefObject<FileInfo[]>;
  setCurrentPose: (pose: string) => void;
  setPoseError: (v: boolean) => void;
  onFilesConsumed: () => void;
}

export function useChatMessages(params: UseChatMessagesParams) {
  const {
    scrollToBottom,
    setUserScrolled,
    serverAddressRef,
    currentAgentNameRef,
    voiceEnabledRef,
    speakRef,
    selectedFilesRef,
    setCurrentPose,
    setPoseError,
    onFilesConsumed,
  } = params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>(ChatStatus.Init);
  const messagesRef = useRef(messages);
  const chatStatusRef = useRef(chatStatus);
  /** 服务器会话 UUID，空字符串表示尚未创建 */
  const sessionIdRef = useRef('');
  /** late-chunk 守卫：abort 后到达的 step_complete 一律丢弃 */
  const abortedRef = useRef(false);
  /** isGenerating 恢复模式标记，complete/error/aborted 时据此判断是否需要磁盘刷新 */
  const recoveringRef = useRef(false);

  /**
   * 统一更新会话 ID：
   * - 写入 ref 供本 hook 内部读取
   * - 持久化到 MMKV，供冷启动恢复
   * - 同步进 sessionStore.activeSessionId，作为侧边栏高亮与会话页加载的唯一来源
   *   只写值、不动刷新触发器，避免引发额外加载
   */
  const setSessionId = useCallback((id: string) => {
    sessionIdRef.current = id;
    saveLastSessionId(id);
    useSessionStore.getState().setActiveSessionId(id);
  }, []);

  /**
   * 从磁盘重新拉取当前 session 的消息列表。
   * 用于 isGenerating 恢复场景：结束事件到达时本地没有完整内容，
   * 从后端获取最终落盘的消息替换占位符。
   */
  const refreshMessagesFromDisk = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) {
      return;
    }
    try {
      const agentId = getServerAgentId();
      const session = await fetchSessionMessages(
        serverAddressRef.current,
        agentId,
        sid
      );
      const chatMessages = convertToChatMessages(
        session.messages,
        session.createdAt,
        currentAgentNameRef.current,
        getAgentAvatarUrl(agentId, serverAddressRef.current)
      );
      setMessages(chatMessages);
      logger.info('[ChatScreen] messages refreshed from disk');
    } catch (e) {
      logger.error(`[ChatScreen] refresh from disk failed: ${e}`);
    }
  }, [serverAddressRef, currentAgentNameRef]);

  /**
   * 注册 ws-client 事件处理器。
   * 组件 mount 时注册，unmount 时注销。
   * title_updated 不在此处处理——ws-client 直接写入 sessionStore。
   */
  useEffect(() => {
    wsClient.registerHandler({
      onStepComplete: (
        content: string | undefined,
        thinking: string | undefined,
        toolCalls?: ToolCall[],
        toolResults?: WsToolResult[]
      ) => {
        // abort 后迟到的 chunk 直接丢弃，避免污染 messages[0]
        if (abortedRef.current) {
          logger.info('[ChatScreen] late step_complete ignored after abort');
          return;
        }
        setMessages((prevMessages) => {
          if (prevMessages.length === 0) {
            return prevMessages;
          }
          const newThoughts = cycleToThoughts(
            content,
            thinking,
            toolCalls,
            toolResults
          );
          const newMessages = [...prevMessages];
          newMessages[0] = {
            ...prevMessages[0],
            text: content || prevMessages[0].text,
            steps: [...(prevMessages[0].steps || []), ...newThoughts],
          };
          return newMessages;
        });

        // 检测 show_pose 指令，切换陪伴立绘
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            if (tc.name === 'show_pose' && tc.arguments) {
              const pose = tc.arguments.pose as string;
              const result = toolResults?.find((tr) => tr.toolCallId === tc.id);
              if (pose && result?.success) {
                logger.debug(`[ChatScreen] pose change: ${pose}`);
                setCurrentPose(pose);
                setPoseError(false);
              }
            }
          }
        }

        // 工具执行失败时记录日志
        if (toolResults && toolResults.length > 0) {
          const failed = toolResults.filter((tr) => !tr.success);
          if (failed.length > 0) {
            logger.warn(
              `[ChatScreen] tool failures: ${failed
                .map((tr) => `${tr.toolName}(${tr.result.substring(0, 60)})`)
                .join(', ')}`
            );
          }
        }

        // 更新侧边栏会话预览为 assistant 最新回复
        if (content) {
          const sid = sessionIdRef.current;
          if (sid) {
            useSessionStore
              .getState()
              .updateSessionPreview(sid, extractPreview(content));
          }
        }
      },
      onComplete: () => {
        if (recoveringRef.current) {
          recoveringRef.current = false;
          refreshMessagesFromDisk();
          setChatStatus(ChatStatus.Complete);
          logger.info('[ChatScreen] recovery complete, refreshed from disk');
          return;
        }
        trigger(HapticFeedbackTypes.notificationSuccess);
        setMessages((prevMessages) => {
          if (prevMessages.length === 0) {
            return prevMessages;
          }
          const steps = prevMessages[0].steps;
          if (!steps || steps.length === 0) {
            return prevMessages;
          }
          const newMessages = [...prevMessages];
          newMessages[0] = {
            ...prevMessages[0],
            steps: stripLastTextThought(steps),
          };
          return newMessages;
        });
        setChatStatus(ChatStatus.Complete);
      },
      onError: (message: string) => {
        if (recoveringRef.current) {
          recoveringRef.current = false;
          refreshMessagesFromDisk();
          setChatStatus(ChatStatus.Complete);
          logger.info(
            '[ChatScreen] recovery ended with error, refreshed from disk'
          );
          return;
        }
        setMessages((prevMessages) => {
          if (prevMessages.length === 0) {
            return prevMessages;
          }
          const newMessages = [...prevMessages];
          newMessages[0] = {
            ...prevMessages[0],
            text: i18n.t('chat.error', { message }),
          };
          return newMessages;
        });
        setChatStatus(ChatStatus.Complete);
      },
      onAborted: () => {
        if (recoveringRef.current) {
          recoveringRef.current = false;
          refreshMessagesFromDisk();
          setChatStatus(ChatStatus.Complete);
          logger.info(
            '[ChatScreen] recovery ended with abort, refreshed from disk'
          );
          return;
        }
        abortedRef.current = true;
        setMessages((prevMessages) => {
          if (prevMessages.length === 0) {
            return prevMessages;
          }
          const botMsg = prevMessages[0];
          // 空占位（没收到过 step_complete，text 还是占位符、steps 为空）直接移除
          const isEmptyPlaceholder =
            (!botMsg.steps || botMsg.steps.length === 0) &&
            botMsg.text === textPlaceholder;
          if (isEmptyPlaceholder) {
            logger.info('[ChatScreen] empty placeholder removed on abort');
            return prevMessages.slice(1);
          }
          // 有内容的半成品打 aborted 标记保留
          const newMessages = [...prevMessages];
          newMessages[0] = { ...botMsg, aborted: true };
          return newMessages;
        });
        setChatStatus(ChatStatus.Complete);
        logger.info('[ChatScreen] turn aborted, partial kept');
      },
      onSpeakReady: (data: {
        speakText: string;
        voiceId: string;
        apiKey: string;
        model: string;
        languageBoost?: string;
      }) => {
        if (!voiceEnabledRef.current) {
          logger.info('[ChatScreen] speak_ready ignored: voice disabled');
          return;
        }
        logger.info(
          `[ChatScreen] speak_ready, textLen=${data.speakText.length}`
        );
        speakRef.current(data);
      },
      onSpeakError: (_reason: string, message: string) => {
        logger.error(`[ChatScreen] speak_error: ${message}`);
      },
      onSubscribed: (isGenerating: boolean) => {
        if (!isGenerating) {
          return;
        }
        // 只增不减：已在 Running 则跳过，避免与 onSend 冲突
        if (chatStatusRef.current === ChatStatus.Running) {
          return;
        }
        recoveringRef.current = true;
        setChatStatus(ChatStatus.Running);
        const agentId = getServerAgentId();
        setMessages((prevMessages) => [
          createBotMessage(
            currentAgentNameRef.current,
            getAgentAvatarUrl(agentId, serverAddressRef.current)
          ),
          ...prevMessages,
        ]);
        scrollToBottom();
        logger.info(
          '[ChatScreen] session is generating, recovering loading state'
        );
      },
    });

    return () => {
      wsClient.unregisterHandler();
    };
  }, [
    setCurrentPose,
    setPoseError,
    speakRef,
    voiceEnabledRef,
    refreshMessagesFromDisk,
    currentAgentNameRef,
    scrollToBottom,
    serverAddressRef,
  ]);

  /** 发送消息：构造用户消息，附带文件，插入 AI 占位消息以触发流式回复 */
  const onSend = useCallback(
    async (text: string) => {
      setUserScrolled(false);
      const files = selectedFilesRef.current;
      if (!isAllFileReady(files)) {
        return;
      }

      const messageText =
        text || (files.length > 0 ? getFileTypeSummary(files) : '');
      if (!messageText && files.length === 0) {
        return;
      }

      const message: ChatMessage = {
        text: messageText,
        user: { _id: 1 },
        createdAt: new Date(),
        _id: uuid.v4(),
      };

      if (files.length > 0) {
        message.image = JSON.stringify(files);
        onFilesConsumed();
      }

      trigger(HapticFeedbackTypes.impactMedium);
      scrollToBottom();

      abortedRef.current = false;
      setChatStatus(ChatStatus.Running);
      const agentId = getServerAgentId();
      setMessages((previousMessages) => [
        createBotMessage(
          currentAgentNameRef.current,
          getAgentAvatarUrl(agentId, serverAddressRef.current)
        ),
        ...GiftedChat.append(previousMessages, [message]),
      ]);

      try {
        let sessionId = sessionIdRef.current;
        if (!sessionId) {
          logger.debug(
            '[ChatScreen] onSend: no server session, auto-creating...'
          );
          sessionId = await createSession(agentId, serverAddressRef.current!);
          setSessionId(sessionId);
          logger.debug(
            `[ChatScreen] onSend: auto-created session ${sessionId}`
          );
        }
        logger.debug(
          `[ChatScreen] onSend: text="${messageText.substring(
            0,
            80
          )}" sessionId=${sessionId}`
        );
        // 更新侧边栏会话预览为用户消息
        useSessionStore
          .getState()
          .updateSessionPreview(sessionId, extractPreview(messageText));
        wsClient.subscribe(sessionId);
        await sendChatMessage(
          agentId,
          sessionId,
          messageText,
          serverAddressRef.current!,
          voiceEnabledRef.current
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatScreen] onSend error: ${errMsg}`);
      }
    },
    [
      setSessionId,
      scrollToBottom,
      setUserScrolled,
      selectedFilesRef,
      currentAgentNameRef,
      serverAddressRef,
      voiceEnabledRef,
      onFilesConsumed,
    ]
  );

  /** 请求服务端中止当前会话的生成 */
  const onStop = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) {
      return;
    }
    wsClient.abort(sid);
    logger.info(`[ChatScreen] abort requested, sid=${sid}`);
  }, []);

  return {
    messages,
    setMessages,
    chatStatus,
    setChatStatus,
    chatStatusRef,
    messagesRef,
    sessionIdRef,
    setSessionId,
    onSend,
    onStop,
  };
}
