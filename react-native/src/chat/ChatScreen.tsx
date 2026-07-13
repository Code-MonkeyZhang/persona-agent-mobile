/**
 * @file ChatScreen.tsx
 * @description 聊天页面主组件，管理消息收发、AI 流式回复、WebSocket 连接、Agent 切换、文件附件等功能。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GiftedChat } from 'react-native-gifted-chat';
import {
  AppState,
  Dimensions,
  FlatList,
  Keyboard,
  LayoutAnimation,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import { ColorScheme, useTheme } from '../theme/index.ts';
import CustomMessageComponent from './component/CustomMessageComponent.tsx';
import { CustomScrollToBottomComponent } from './component/CustomScrollToBottomComponent.tsx';
import { EmptyChatComponent } from './component/EmptyChatComponent.tsx';
import AgentSelector from './component/AgentSelector.tsx';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import uuid from 'uuid';
import { RouteParamList } from '../types/RouteTypes.ts';
import {
  getServerAddress,
  getServerAgentId,
  saveServerAgentId,
  getCompanionOpen,
  saveCompanionOpen,
  getLastSessionId,
  saveLastSessionId,
} from '../storage/StorageUtils.ts';
import {
  ServerClient,
  fetchAgents,
  fetchPoses,
  fetchSessionMessages,
  convertToChatMessages,
  getAgentAvatarUrl,
} from '../api/server-api.ts';
import type { AgentInfo } from '../api/server-api.ts';
import { logger } from '../lib/logger';
import { ChatStatus, FileInfo, ChatMessage } from '../types/Chat.ts';
import { useAppContext } from '../history/AppProvider.tsx';
import { CustomHeaderRightButton } from './component/CustomHeaderRightButton.tsx';
import { trigger } from './util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import FloatingInputBar from './component/FloatingInputBar.tsx';
import CompanionContent from './component/CompanionContent.tsx';
import {
  checkFileNumberLimit,
  getFileTypeSummary,
  isAllFileReady,
} from './util/FileUtils.ts';
import { showInfo } from './util/ToastUtils.ts';
import { cycleToThoughts, stripLastTextThought } from './util/thought-utils';
import Toast from 'react-native-toast-message';
import { HeaderOptions } from '@react-navigation/elements';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  FadeInDown,
} from 'react-native-reanimated';
import { UserRound, Mic, MicOff } from 'lucide-react-native';
import { useVoiceStore } from '../stores/voiceStore';

/** AI 消息的用户 ID，用于 GiftedChat 区分用户和 AI */
const BOT_ID = 2;

/**
 * 创建一条 AI 占位消息，在流式回复开始前插入消息列表。
 * @param agentName 当前 Agent 的显示名称
 * @param avatar Agent 头像 URL
 * @returns 占位的 ChatMessage，文本内容为 "..."，steps 为空数组
 */
const createBotMessage = (agentName: string, avatar: string) => {
  return {
    _id: uuid.v4() as string,
    text: textPlaceholder,
    createdAt: new Date(),
    user: {
      _id: BOT_ID,
      name: agentName,
      avatar,
    },
    steps: [] as ChatMessage['steps'],
  };
};

/** AI 回复加载中的占位文本 */
const textPlaceholder = '...';

/** Header 右侧按钮行容器样式 */
const headerRightContainerStyle = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center' },
});

/** 陪伴回复气泡样式 */
const bubbleStyles = StyleSheet.create({
  outer: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  inner: {
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  scroll: {
    maxHeight: 160,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  text: {
    fontSize: 14,
    color: '#333',
    lineHeight: 22,
  },
  thinking: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});

/** 聊天页面的路由参数类型，携带 sessionId 和 tapIndex */
type ChatScreenRouteProp = RouteProp<RouteParamList, 'Bedrock'>;

/** 聊天页面的导航类型，支持跳转到 Stack 下的所有页面 */
type ChatScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Bedrock'
>;

// 聊天页面主组件：管理消息收发、AI 流式输出、语音聊天、文件上传等
function ChatScreen(): React.JSX.Element {
  // ==================== 路由参数 ====================
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();
  const initialSessionId = route.params?.sessionId ?? getLastSessionId();
  const tapIndex = route.params?.tapIndex;

  // ==================== 状态声明 ====================
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [screenDimensions, setScreenDimensions] = useState(
    Dimensions.get('window')
  );
  const [chatStatus, setChatStatus] = useState<ChatStatus>(ChatStatus.Init);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [userScrolled, setUserScrolled] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState(
    getServerAgentId() || ''
  );
  const chatStatusRef = useRef(chatStatus);
  const messagesRef = useRef(messages);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const textInputViewRef = useRef<TextInput>(null);
  /** 服务器会话 UUID，空字符串表示尚未创建 */
  const sessionIdRef = useRef(initialSessionId || '');

  /** 统一更新会话 ID：同步到 ref 和 MMKV 持久化 */
  const setSessionId = useCallback((id: string) => {
    sessionIdRef.current = id;
    saveLastSessionId(id);
  }, []);
  const { sendEvent, event } = useAppContext();
  const sendEventRef = useRef(sendEvent);
  const [selectedFiles, setSelectedFiles] = useState<FileInfo[]>([]);
  const selectedFilesRef = useRef(selectedFiles);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const currentScrollOffsetRef = useRef(0);
  /** 当前活跃的 ServerClient 实例，未连接时为 null */
  const serverClientRef = useRef<ServerClient | null>(null);
  /** 服务器地址缓存，从 MMKV 加载 */
  const serverAddressRef = useRef(getServerAddress());

  // ==================== 陪伴模式状态 ====================
  /** 陪伴面板是否展开（滑动容器右侧 pane），从 MMKV 恢复上次状态 */
  const [companionOpen, setCompanionOpen] = useState(getCompanionOpen);
  /** Agent 是否拥有陪伴资源：null=加载中, true=有, false=无 */
  const [hasAssets, setHasAssets] = useState<boolean | null>(null);
  /** 当前展示的姿态名称，由 show_pose 指令切换 */
  const [currentPose, setCurrentPose] = useState('default');
  /** 背景图加载失败标记 */
  const [bgError, setBgError] = useState(false);
  /** 立绘图加载失败标记 */
  const [poseError, setPoseError] = useState(false);

  /** FIB 容器实际高度（含 paddingBottom），用于 GiftedChat footer 留白 */
  const [fibWrapperHeight, setFibWrapperHeight] = useState(130);

  // ==================== voiceStore ====================
  const voiceEnabled = useVoiceStore((s) => s.voiceEnabled);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const speak = useVoiceStore((s) => s.speak);
  const stopSpeaking = useVoiceStore((s) => s.stopSpeaking);

  /** 陪伴模式、语音状态和 TTS 方法的 ref，供 useFocusEffect 等稳定回调中读取最新值 */
  const companionOpenRef = useRef(companionOpen);
  const voiceEnabledRef = useRef(voiceEnabled);
  const speakRef = useRef(speak);
  const stopSpeakingRef = useRef(stopSpeaking);
  /** 当前 Agent 显示名称的 ref，供 onSend / loadSession 等异步回调中读取 */
  const currentAgentNameRef = useRef('AI');

  // ==================== Ref 同步 & 副作用 ====================
  /** 每次状态变化后同步到 ref，供异步回调中读取最新值 */
  useEffect(() => {
    messagesRef.current = messages;
    chatStatusRef.current = chatStatus;
    companionOpenRef.current = companionOpen;
    voiceEnabledRef.current = voiceEnabled;
    speakRef.current = speak;
    stopSpeakingRef.current = stopSpeaking;
    currentAgentNameRef.current =
      agents.find((a) => a.id === currentAgentId)?.name ?? 'AI';
  }, [
    chatStatus,
    messages,
    companionOpen,
    voiceEnabled,
    speak,
    stopSpeaking,
    agents,
    currentAgentId,
  ]);

  /** AI 流式输出期间保持屏幕常亮，避免锁屏中断 */
  useEffect(() => {
    if (chatStatus === ChatStatus.Running) {
      activateKeepAwake();
    } else {
      deactivateKeepAwake();
    }
    return () => {
      deactivateKeepAwake();
    };
  }, [chatStatus]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  // ==================== Server Client 初始化 ====================
  /**
   * 屏幕获得焦点时初始化 ServerClient。
   * 使用 useFocusEffect 而非 useEffect，确保从设置页返回后能重新检测。
   *
   * 流程：读取服务器地址 → 获取 agent → 注册回调 → connect → 存入 serverClientRef。
   * 离开屏幕时自动 disconnect 并置空 ref。
   */
  useFocusEffect(
    React.useCallback(() => {
      const address = getServerAddress();
      logger.info(
        `[ChatScreen] server client init (focus), serverAddress="${address}"`
      );

      if (serverClientRef.current) {
        logger.warn('[ChatScreen] server client already connected, skip');
        return;
      }

      if (!address) {
        return;
      }
      serverAddressRef.current = address;

      let cancelled = false;
      const client = new ServerClient();

      (async () => {
        try {
          const fetchedAgents = await fetchAgents(address);
          if (cancelled || fetchedAgents.length === 0) {
            return;
          }
          setAgents(fetchedAgents);

          let agentId = getServerAgentId();
          if (!agentId || !fetchedAgents.some((a) => a.id === agentId)) {
            agentId = fetchedAgents[0].id;
          }
          saveServerAgentId(agentId);
          setCurrentAgentId(agentId);
          logger.info(`[ChatScreen] using agentId=${agentId}`);

          client.onStepComplete = (
            content,
            thinking,
            toolCalls,
            toolResults
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
                  if (pose) {
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
                    .map(
                      (tr) => `${tr.toolName}(${tr.result.substring(0, 60)})`
                    )
                    .join(', ')}`
                );
              }
            }
          };

          client.onComplete = () => {
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
          };

          client.onError = (message) => {
            setMessages((prevMessages) => {
              if (prevMessages.length === 0) {
                return prevMessages;
              }
              const newMessages = [...prevMessages];
              newMessages[0] = {
                ...prevMessages[0],
                text: 'Error: ' + message,
              };
              return newMessages;
            });
            setChatStatus(ChatStatus.Complete);
          };

          /**
           * 服务器更新会话标题时，通过 AppContext 跨组件通信通知 Drawer 更新。
           */
          client.onTitleUpdated = (sessionId, title) => {
            sendEventRef.current('titleUpdated', { id: sessionId, title });
          };

          /** TTS 合成参数就绪，调 voiceStore 播报 */
          client.onSpeakReady = (data) => {
            logger.info(
              `[ChatScreen] speak_ready, textLen=${data.speakText.length}`
            );
            speakRef.current(data);
          };

          /** TTS 合成失败，显示错误提示 */
          client.onSpeakError = (_reason, message) => {
            logger.error(`[ChatScreen] speak_error: ${message}`);
            Toast.show({
              type: 'warning',
              text1: message,
              position: 'bottom',
              visibilityTime: 3000,
            });
          };

          await client.connect(address);
          if (cancelled) {
            return;
          }
          serverClientRef.current = client;
          logger.info('[ChatScreen] server client ready');
        } catch (e) {
          logger.error(
            `[ChatScreen] server client init failed: ${
              e instanceof Error ? e.message : e
            }`
          );
        }
      })();

      return () => {
        cancelled = true;
        client.disconnect();
        serverClientRef.current = null;
        stopSpeakingRef.current();
      };
    }, [])
  );

  // ==================== 新建聊天 & 导航栏 ====================
  /**
   * 开始新聊天：纯前端操作，不立即创建服务器会话。
   * 清空当前会话 ID 和消息，取消侧边栏高亮，弹出键盘。
   * 服务器会话在用户发送第一条消息时由 onSend 懒创建。
   */
  const startNewChat = useRef(
    useCallback(() => {
      trigger(HapticFeedbackTypes.impactMedium);
      logger.info('[ChatScreen] startNewChat');
      setSessionId('');
      sendEventRef.current('updateHistorySelectedId', { id: '' });
      setMessages([]);
      showKeyboard();
    }, [setSessionId])
  );

  // ==================== Agent 切换 ====================
  /**
   * 切换当前 Agent：保存选择、清空消息、通知侧边栏刷新。
   * @param newAgentId 用户选中的 Agent ID
   */
  const handleSelectAgent = useCallback(
    (newAgentId: string) => {
      if (newAgentId === currentAgentId) {
        return;
      }

      saveServerAgentId(newAgentId);
      setCurrentAgentId(newAgentId);

      setMessages([]);
      setSessionId('');
      stopSpeakingRef.current();

      sendEventRef.current('agentChanged', { id: newAgentId });
    },
    [currentAgentId, setSessionId]
  );

  // ==================== 陪伴资源加载 ====================
  /**
   * Agent 切换时请求 pose 列表，判断是否有陪伴资源。
   * 结果写入 hasAssets 三态，同时重置错误标记和姿态。
   */
  useEffect(() => {
    if (!currentAgentId || !serverAddressRef.current) {
      return;
    }
    let cancelled = false;
    setHasAssets(null);
    setBgError(false);
    setPoseError(false);
    setCurrentPose('default');
    logger.info(`[ChatScreen] fetchPoses agentId=${currentAgentId}`);
    fetchPoses(currentAgentId, serverAddressRef.current)
      .then((poses) => {
        logger.info(`[ChatScreen] poses loaded: ${poses.length}`);
        if (!cancelled) {
          setHasAssets(poses.length > 0);
        }
      })
      .catch(() => {
        logger.error('[ChatScreen] fetchPoses failed');
        if (!cancelled) {
          setHasAssets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentAgentId]);

  /** 切换陪伴面板：先收键盘再 toggle，避免动画与键盘同时变化；持久化到 MMKV */
  const handleToggleCompanion = useCallback(() => {
    Keyboard.dismiss();
    setCompanionOpen((prev) => {
      const next = !prev;
      saveCompanionOpen(next);
      logger.info(`[ChatScreen] companion ${next ? 'open' : 'close'}`);
      return next;
    });
  }, []);

  /** 关闭陪伴面板时停止语音播放 */
  useEffect(() => {
    if (!companionOpen) {
      stopSpeakingRef.current();
    }
  }, [companionOpen]);

  /** 语音开关：toggleVoice 内部处理开关切换和播报停止 */
  const handleToggleVoice = useCallback(() => {
    toggleVoice();
  }, [toggleVoice]);

  /** 根据主题和 Agent 列表更新导航栏标题和右侧按钮 */
  React.useLayoutEffect(() => {
    const headerOptions: HeaderOptions = {
      // eslint-disable-next-line react/no-unstable-nested-components
      headerTitle: () => (
        <AgentSelector
          agents={agents}
          currentAgentId={currentAgentId}
          onSelectAgent={handleSelectAgent}
        />
      ),
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <View style={headerRightContainerStyle.root}>
          <CustomHeaderRightButton onPress={handleToggleVoice}>
            {voiceEnabled ? (
              <Mic
                size={20}
                color={isSpeaking ? colors.primary : colors.text}
              />
            ) : (
              <MicOff size={20} color={colors.text} />
            )}
          </CustomHeaderRightButton>
          <CustomHeaderRightButton onPress={handleToggleCompanion}>
            <UserRound
              size={22}
              color={companionOpen ? colors.primary : colors.text}
            />
          </CustomHeaderRightButton>
        </View>
      ),
    };
    // 类型断言：HeaderOptions 类型与 navigation.setOptions 的参数类型不完全匹配，
    // 需要手动断言以通过 TypeScript 检查（实际运行时无影响）
    navigation.setOptions(
      headerOptions as Parameters<typeof navigation.setOptions>[0]
    );
  }, [
    navigation,
    agents,
    currentAgentId,
    handleSelectAgent,
    companionOpen,
    voiceEnabled,
    isSpeaking,
    colors.primary,
    colors.text,
    handleToggleVoice,
    handleToggleCompanion,
  ]);

  // ==================== 会话切换 & 消息加载 ====================
  /**
   * 监听路由参数变化（新建聊天或点击历史记录），加载对应的会话消息。
   */
  useEffect(() => {
    if (tapIndex && initialSessionId) {
      if (sessionIdRef.current === initialSessionId) {
        return;
      }
      if (chatStatusRef.current === ChatStatus.Running) {
        chatStatusRef.current = ChatStatus.Init;
      }
      setSelectedFiles([]);
      setChatStatus(ChatStatus.Init);
      sendEventRef.current('');
      if (initialSessionId === '' || initialSessionId === '-1') {
        startNewChat.current();
        return;
      }
      // click from history — 从服务器拉取消息
      setMessages([]);
      setIsLoadingMessages(true);
      setSessionId(initialSessionId);

      (async () => {
        try {
          const agentId = getServerAgentId();
          const session = await fetchSessionMessages(
            serverAddressRef.current,
            agentId,
            initialSessionId
          );
          const chatMessages = convertToChatMessages(
            session.messages,
            session.createdAt,
            currentAgentNameRef.current,
            getAgentAvatarUrl(agentId, serverAddressRef.current)
          );
          setMessages(chatMessages);
          serverClientRef.current?.subscribe(initialSessionId);
        } catch (e) {
          logger.error(`[ChatScreen] loadSession failed: ${e}`);
        } finally {
          setIsLoadingMessages(false);
          setTimeout(scrollToBottom, 200);
        }
      })();
    }
  }, [initialSessionId, tapIndex, setSessionId]);

  // ==================== 事件监听 ====================
  /** 监听 AppContext 事件：侧边栏点击新建对话 */
  useEffect(() => {
    if (event?.event === 'newChat') {
      logger.info('[ChatScreen] newChat event received');
      textInputViewRef?.current?.clear();
      setSelectedFiles([]);
      startNewChat.current();
    }
  }, [event]);

  /** 监听 AppContext 事件：删除聊天时清空当前会话 */
  useEffect(() => {
    if (event?.event === 'deleteChat' && event.params) {
      const { id } = event.params;
      if (sessionIdRef.current === id) {
        setSessionId('');
        sendEventRef.current('updateHistorySelectedId', {
          id: '',
        });
        setMessages([]);
      }
    }
  }, [event, setSessionId]);

  // ==================== 键盘 & 屏幕 & 生命周期 ====================
  /**
   * 键盘避让与滚动控制。
   * 监听键盘弹出/收起，通过 keyboardHeight 驱动 FIB 容器的 paddingBottom，
   * 使输入框始终贴合键盘上沿。弹出时若输入框已聚焦则自动滚到底部。
   */
  useEffect(() => {
    const showEvent = Platform.select({
      ios: 'keyboardWillShow',
      android: 'keyboardDidShow',
    }) as 'keyboardWillShow' | 'keyboardDidShow';
    const hideEvent = Platform.select({
      ios: 'keyboardWillHide',
      android: 'keyboardDidHide',
    }) as 'keyboardWillHide' | 'keyboardDidHide';

    /** 配置与键盘动画同步的 LayoutAnimation */
    const animate = (duration: number) => {
      const d = (duration > 10 ? duration : 10) * 1.15;
      LayoutAnimation.configureNext({
        duration: d,
        update: {
          duration: d,
          type: 'easeInEaseOut',
        },
      });
    };

    const showListener = Keyboard.addListener(showEvent, (e) => {
      const { height } = e.endCoordinates;
      animate(e.duration);
      setKeyboardHeight(height);
      if (textInputViewRef.current?.isFocused()) {
        scrollToBottom();
      }
      logger.info(`[Keyboard] show height=${height}`);
    });

    const hideListener = Keyboard.addListener(hideEvent, (e) => {
      animate(e.duration);
      setKeyboardHeight(0);
      logger.info('[Keyboard] hide');
    });

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  /** 首次进入页面时自动弹出键盘 */
  useEffect(() => {
    showKeyboard();
  }, []);

  /** 延迟 100ms 后聚焦输入框，等待布局完成 */
  const showKeyboard = () => {
    setTimeout(() => {
      textInputViewRef.current?.focus();
    }, 100);
  };

  /** 监听屏幕旋转，更新屏幕宽高以重新计算布局 */
  useEffect(() => {
    const updateDimensions = () => {
      setScreenDimensions(Dimensions.get('window'));
    };

    const subscription = Dimensions.addEventListener(
      'change',
      updateDimensions
    );

    return () => {
      subscription?.remove();
    };
  }, []);

  // ==================== 消息完成 ====================
  /** AI 回复完成后通知侧边栏刷新历史列表 */
  useEffect(() => {
    if (chatStatus === ChatStatus.Complete) {
      if (messagesRef.current.length <= 1) {
        return;
      }
      sendEventRef.current('updateHistory');
      setTimeout(() => {
        sendEventRef.current('updateHistorySelectedId', {
          id: sessionIdRef.current,
        });
      }, 100);
      setChatStatus(ChatStatus.Init);
    }
  }, [chatStatus]);

  /** App 进入后台时的生命周期监听（目前为占位，未做额外处理） */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => {});
    return () => {
      subscription.remove();
    };
  }, []);

  // ==================== 滚动控制 ====================
  const { width: screenWidth } = screenDimensions;

  const scrollStyle = StyleSheet.create({
    scrollToBottomContainerStyle: {
      width: 30,
      height: 30,
      right: 16,
      bottom: fibWrapperHeight + 10,
    },
  });

  /** 滑动容器布局样式：宽度依赖屏幕尺寸，每次 render 重新计算 */
  const slideStyle = StyleSheet.create({
    row: {
      width: screenWidth * 2,
      height: '100%',
      flexDirection: 'row',
    },
    pane: {
      width: screenWidth,
      height: '100%',
    },
    /** GiftedChat footer 留白，等于 FIB 高度，防止消息被浮动 FIB 遮挡 */
    chatFooterSpacer: {
      height: fibWrapperHeight,
    },
  });

  /** 将消息列表滚动到顶部（GiftedChat 是倒序的，offset=0 即最新消息） */
  const scrollToBottom = () => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  };

  /**
   * 将消息列表向上或向下偏移指定高度，用于展开/收起 Reasoning 区块时保持视觉位置不跳动。
   * @param expanded 是否展开（展开时向上偏移，收起时向下回滚）
   * @param height 偏移的像素高度
   * @param animated 是否带动画
   */
  const scrollUpByHeight = (
    expanded: boolean,
    height: number,
    animated: boolean
  ) => {
    if (flatListRef.current) {
      const newOffset =
        currentScrollOffsetRef.current + (expanded ? height : -height);
      flatListRef.current.scrollToOffset({
        offset: newOffset,
        animated: animated,
      });
    }
  };

  /** 记录当前滚动偏移量，供 scrollUpByHeight 计算新位置 */
  const handleScroll = (
    scrollEvent: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    currentScrollOffsetRef.current = scrollEvent.nativeEvent.contentOffset.y;
  };

  /** 用户手动拖拽滚动时标记 userScrolled，暂停自动滚底 */
  const handleUserScroll = (_: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (chatStatusRef.current === ChatStatus.Running) {
      setUserScrolled(true);
    }
  };

  /**
   * 惯性滚动结束后的回调：如果用户在流式输出期间滚动到了接近底部的位置，自动回到底部。
   */
  const handleMomentumScrollEnd = (
    endEvent: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    if (chatStatusRef.current === ChatStatus.Running && userScrolled) {
      const { contentOffset } = endEvent.nativeEvent;
      if (contentOffset.y > 0 && contentOffset.y < 100) {
        scrollToBottom();
      }
    }
  };

  /** Reasoning 区块展开/收起时调整滚动位置，用 useCallback 避免消息组件重渲染 */
  const handleReasoningToggle = useCallback(
    (expanded: boolean, height: number, animated: boolean) => {
      scrollUpByHeight(expanded, height, animated);
    },
    []
  );

  // ==================== 发送消息 ====================
  /** 发送消息：构造用户消息，附带文件，插入 AI 占位消息以触发流式回复 */
  const onSend = useCallback(async (text: string) => {
    // 发新消息时，重置用户滚动状态，让界面能自动滚到底部
    setUserScrolled(false);
    // 取出当前选中的附件文件
    const files = selectedFilesRef.current;
    // 如果有视频还在转码/压缩中，提示等待
    if (!isAllFileReady(files)) {
      showInfo('please wait for all videos to be ready');
      return;
    }

    // 确定消息文本：有输入文本则用输入文本，否则用文件摘要作为占位
    const messageText =
      text || (files.length > 0 ? getFileTypeSummary(files) : '');
    if (!messageText && files.length === 0) {
      return;
    }

    // 构造用户消息
    const message: ChatMessage = {
      text: messageText,
      user: { _id: 1 },
      createdAt: new Date(),
      _id: uuid.v4(),
    };

    if (files.length > 0) {
      message.image = JSON.stringify(files);
      setSelectedFiles([]);
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

    (async () => {
      try {
        let sessionId = sessionIdRef.current;
        if (!sessionId) {
          logger.debug(
            '[ChatScreen] onSend: no server session, auto-creating...'
          );
          sessionId = await serverClientRef.current!.createSession(
            agentId,
            serverAddressRef.current!
          );
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
        serverClientRef.current?.subscribe(sessionId);
        await serverClientRef.current!.sendChatMessage(
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
    })();
  }, [setSessionId]);

  // ==================== 文件 & 语音转录 ====================
  /**
   * 新增文件回调：检查数量限制后合并到 selectedFiles。
   * 由 FloatingInputBar 内的 CustomAddFileComponent 触发。
   */
  const handleNewFileSelected = useCallback((newFiles: FileInfo[]) => {
    setSelectedFiles((prev) => checkFileNumberLimit(prev, newFiles));
  }, []);

  /**
   * 文件更新回调：删除或压缩后直接替换 selectedFiles。
   * 由 FloatingInputBar 内的 CustomChatFooter 触发。
   */
  const handleFileUpdated = useCallback((files: FileInfo[]) => {
    setSelectedFiles(files);
  }, []);

  /** 停止 AI 回复：将占位消息改为已取消，设置状态为完成 */
  const handleStopPress = useCallback(() => {
    trigger(HapticFeedbackTypes.notificationWarning);
    setMessages((prevMessages) => {
      if (prevMessages.length === 0) {
        return prevMessages;
      }
      const newMessages = [...prevMessages];
      if (
        newMessages[0].text === textPlaceholder ||
        newMessages[0].text === ''
      ) {
        newMessages[0] = { ...newMessages[0], text: 'Canceled...' };
      }
      return newMessages;
    });
    setChatStatus(ChatStatus.Complete);
  }, []);

  // ==================== UI 渲染 ====================
  /**
   * 滑动容器动画：companionOpen 切换时通过 translateX 横向滑动，
   * 0 = 显示聊天列表，-screenWidth = 显示陪伴面板。
   */
  const slideTranslateX = useSharedValue(0);
  useEffect(() => {
    slideTranslateX.value = withTiming(
      companionOpen ? -screenDimensions.width : 0,
      { duration: 300, easing: Easing.inOut(Easing.ease) }
    );
  }, [companionOpen, screenDimensions.width, slideTranslateX]);

  const slideAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideTranslateX.value }],
  }));

  const styles = createStyles(colors);

  // 陪伴回复气泡数据：最新一条 AI 消息（GiftedChat 倒序，messages[0] 即最新）
  const lastAgentMessage =
    messages.length > 0 && messages[0].user._id === BOT_ID ? messages[0] : null;
  const isThinking = lastAgentMessage?.text === textPlaceholder;

  return (
    <View style={styles.container}>
      {/* 内容区：overflow hidden 裁剪滑出的 pane */}
      <View style={styles.contentArea}>
        <Animated.View style={[slideStyle.row, slideAnimatedStyle]}>
          {/* Pane 1: 聊天列表 */}
          <View style={slideStyle.pane}>
            <GiftedChat
              // 消息列表的 ref，用于代码中控制滚动（如 scrollToBottom、编辑时滚动定位）
              messageContainerRef={flatListRef}
              // 点击非可交互区域时收起键盘
              keyboardShouldPersistTaps="never"
              messages={messages}
              user={{
                _id: 1,
              }}
              alignTop={false}
              inverted={true}
              // 禁用 GiftedChat 内部键盘处理，键盘避让由手动 paddingBottom 控制
              isKeyboardInternallyHandled={false}
              // 输入栏高度设为 0，让消息列表撑满整个区域
              minInputToolbarHeight={0}
              minComposerHeight={0}
              /** 空聊天页面：无消息时显示的欢迎界面 */
              renderChatEmpty={() => (
                <EmptyChatComponent isLoadingMessages={isLoadingMessages} />
              )}
              /** 底部留白：等于 FIB 高度，防止消息被浮动输入框遮挡 */
              renderChatFooter={() => (
                <View style={slideStyle.chatFooterSpacer} />
              )}
              /** 禁用 GiftedChat 内置输入栏 */
              renderInputToolbar={() => null}
              /** 自定义消息渲染：用 CustomMessageComponent 替代默认气泡，支持 Markdown、Reasoning、引用等 */
              renderMessage={(props) => {
                // Find the index of the current message in the messages array
                const messageIndex = messages.findIndex(
                  (msg) => msg._id === props.currentMessage?._id
                );

                const isLastAIMessage =
                  props.currentMessage?._id === messages[0]?._id &&
                  props.currentMessage?.user._id !== 1;

                return (
                  <CustomMessageComponent
                    {...props}
                    chatStatus={chatStatus}
                    isLastAIMessage={isLastAIMessage}
                    onReasoningToggle={handleReasoningToggle}
                    messageIndex={messageIndex}
                    flatListRef={flatListRef}
                  />
                );
              }}
              /** 消息列表配置：滚动监听、自动滚动控制、流式输出时保持消息位置不跳动 */
              listViewProps={{
                contentContainerStyle: styles.contentContainer,
                contentInset: { top: 2 },
                onLayout: (layoutEvent: LayoutChangeEvent) => {
                  containerHeightRef.current =
                    layoutEvent.nativeEvent.layout.height;
                },
                onScrollEvent: handleScroll,
                onContentSizeChange: (_width: number, height: number) => {
                  contentHeightRef.current = height;
                },
                onScrollBeginDrag: handleUserScroll,
                onMomentumScrollEnd: handleMomentumScrollEnd,
                ...(userScrolled &&
                chatStatus === ChatStatus.Running &&
                contentHeightRef.current > containerHeightRef.current
                  ? {
                      maintainVisibleContentPosition: {
                        minIndexForVisible: 0,
                        autoscrollToTopThreshold: 0,
                      },
                    }
                  : {}),
              }}
              scrollToBottom={true}
              scrollToBottomComponent={CustomScrollToBottomComponent}
              scrollToBottomStyle={scrollStyle.scrollToBottomContainerStyle}
            />
          </View>
          {/* Pane 2: 陪伴内容 */}
          <View style={slideStyle.pane}>
            <CompanionContent
              agentId={currentAgentId}
              serverAddr={serverAddressRef.current}
              hasAssets={hasAssets}
              currentPose={currentPose}
              bgError={bgError}
              poseError={poseError}
              onBgError={() => setBgError(true)}
              onPoseError={() => setPoseError(true)}
              voiceEnabled={voiceEnabled}
              isSpeaking={isSpeaking}
              onToggleVoice={handleToggleVoice}
            />
          </View>
        </Animated.View>
      </View>
      {/* FIB 容器：绝对定位浮在内容上方，paddingBottom 随键盘高度变化 */}
      <View
        style={[
          styles.fibWrapper,
          {
            paddingBottom:
              Platform.OS === 'ios'
                ? Math.max(keyboardHeight, insets.bottom)
                : insets.bottom,
          },
        ]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && h !== fibWrapperHeight) {
            setFibWrapperHeight(h);
          }
        }}
      >
        {/* 陪伴回复气泡：仅陪伴模式且有 AI 回复时显示 */}
        {companionOpen && lastAgentMessage && (
          <Animated.View
            key={lastAgentMessage._id}
            entering={FadeInDown.duration(350)}
            style={bubbleStyles.outer}
          >
            <View style={bubbleStyles.inner}>
              {isThinking ? (
                <Text style={bubbleStyles.thinking}>思考中...</Text>
              ) : (
                <ScrollView style={bubbleStyles.scroll} nestedScrollEnabled>
                  <Text style={bubbleStyles.text}>{lastAgentMessage.text}</Text>
                </ScrollView>
              )}
            </View>
          </Animated.View>
        )}
        <FloatingInputBar
          textInputRef={textInputViewRef}
          onSend={onSend}
          selectedFiles={selectedFiles}
          chatStatus={chatStatus}
          onStopPress={handleStopPress}
          onFileSelected={handleNewFileSelected}
          onFileUpdated={handleFileUpdated}
        />
      </View>
    </View>
  );
}

/** 聊天页面的样式工厂，根据当前主题色生成各组件样式 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    /** 整个聊天页面的容器，relative 定位使 FIB 可以 absolute 浮在上方 */
    container: {
      flex: 1,
      backgroundColor: colors.background,
      position: 'relative',
    },
    /** 内容区：包裹滑动容器，overflow hidden 裁剪非当前 pane */
    contentArea: {
      flex: 1,
      overflow: 'hidden',
    },
    /** FIB 容器：绝对定位浮在内容上方 */
    fibWrapper: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 20,
    },
    /** 消息列表的内容容器，flexGrow + justifyContent 保证消息少时内容在底部 */
    contentContainer: {
      paddingTop: 15,
      paddingBottom: 15,
      flexGrow: 1,
      justifyContent: 'flex-end',
    },
  });

export default ChatScreen;
