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
} from '../../api/server-api';
import type { ToolCall, WsToolResult } from '../../api/server-api';
import {
  getServerAgentId,
  saveLastSessionId,
} from '../../storage/StorageUtils';
import { getFileTypeSummary, isAllFileReady } from '../util/FileUtils';
import { cycleToThoughts, stripLastTextThought } from '../util/thought-utils';
import { showInfo } from '../util/ToastUtils';
import { useSessionStore, extractPreview } from '../../stores/sessionStore';
import { trigger } from '../util/HapticUtils';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types';
import { logger } from '../../lib/logger';
import i18n from '../../i18n/index';
import Toast from 'react-native-toast-message';
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
  companionOpenRef: React.MutableRefObject<boolean>;
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
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function useChatMessages(params: UseChatMessagesParams) {
  const {
    scrollToBottom,
    setUserScrolled,
    serverAddressRef,
    currentAgentNameRef,
    companionOpenRef,
    voiceEnabledRef,
    speakRef,
    selectedFilesRef,
    setCurrentPose,
    setPoseError,
    onFilesConsumed,
    t,
  } = params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>(ChatStatus.Init);
  const messagesRef = useRef(messages);
  const chatStatusRef = useRef(chatStatus);
  /** 服务器会话 UUID，空字符串表示尚未创建 */
  const sessionIdRef = useRef('');

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
      onSpeakReady: (data: {
        speakText: string;
        voiceId: string;
        apiKey: string;
        model: string;
        languageBoost?: string;
      }) => {
        logger.info(
          `[ChatScreen] speak_ready, textLen=${data.speakText.length}`
        );
        speakRef.current(data);
      },
      onSpeakError: (_reason: string, message: string) => {
        logger.error(`[ChatScreen] speak_error: ${message}`);
        Toast.show({
          type: 'warning',
          text1: message,
          position: 'bottom',
          visibilityTime: 3000,
        });
      },
    });

    return () => {
      wsClient.unregisterHandler();
    };
  }, [setCurrentPose, setPoseError, speakRef]);

  /** 发送消息：构造用户消息，附带文件，插入 AI 占位消息以触发流式回复 */
  const onSend = useCallback(
    async (text: string) => {
      setUserScrolled(false);
      const files = selectedFilesRef.current;
      if (!isAllFileReady(files)) {
        showInfo(t('chat.waitVideoReady'));
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
          companionOpenRef.current && voiceEnabledRef.current
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatScreen] onSend error: ${errMsg}`);
      }
    },
    [
      setSessionId,
      t,
      scrollToBottom,
      setUserScrolled,
      selectedFilesRef,
      currentAgentNameRef,
      serverAddressRef,
      companionOpenRef,
      voiceEnabledRef,
      onFilesConsumed,
    ]
  );

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
  };
}
