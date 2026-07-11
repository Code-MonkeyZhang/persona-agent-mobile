/**
 * @file ChatScreen.tsx
 * @description 聊天页面主组件，管理消息收发、AI 流式回复、WebSocket 连接、Agent 切换、文件附件等功能。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Composer, GiftedChat, InputToolbar } from 'react-native-gifted-chat';
import {
  AppState,
  Dimensions,
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  SafeAreaView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
} from '../storage/StorageUtils.ts';
import {
  ServerClient,
  fetchAgents,
  fetchSessionMessages,
  convertToChatMessages,
} from '../api/server-api.ts';
import type { AgentInfo } from '../api/server-api.ts';
import { logger } from '../lib/logger';
import { ChatStatus, FileInfo, ChatMessage } from '../types/Chat.ts';
import { useAppContext } from '../history/AppProvider.tsx';
import { UserRound } from 'lucide-react-native';
import { CustomHeaderRightButton } from './component/CustomHeaderRightButton.tsx';
import CustomSendComponent from './component/CustomSendComponent.tsx';
import { trigger } from './util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import { CustomChatFooter } from './component/CustomChatFooter.tsx';
import {
  checkFileNumberLimit,
  getFileTypeSummary,
  isAllFileReady,
} from './util/FileUtils.ts';
import { showInfo } from './util/ToastUtils.ts';
import { HeaderOptions } from '@react-navigation/elements';

/** AI 消息的用户 ID，用于 GiftedChat 区分用户和 AI */
const BOT_ID = 2;

/**
 * 创建一条 AI 占位消息，在流式回复开始前插入消息列表。
 * @returns 占位的 ChatMessage，文本内容为 "..."
 */
const createBotMessage = () => {
  return {
    _id: uuid.v4(),
    text: textPlaceholder,
    createdAt: new Date(),
    user: {
      _id: BOT_ID,
      name: 'AI',
    },
  };
};

/** AI 回复加载中的占位文本 */
const textPlaceholder = '...';

/** 聊天页面的路由参数类型，携带 sessionId 和 tapIndex */
type ChatScreenRouteProp = RouteProp<RouteParamList, 'Bedrock'>;

/** 聊天页面的导航类型，支持跳转到 Stack 下的所有页面（包括 Companion 等全屏页面） */
type ChatScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Bedrock'
>;

// 聊天页面主组件：管理消息收发、AI 流式输出、语音聊天、文件上传等
function ChatScreen(): React.JSX.Element {
  // ==================== 路由参数 ====================
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();
  const initialSessionId = route.params?.sessionId;
  const tapIndex = route.params?.tapIndex;

  // ==================== 状态声明 ====================
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [screenDimensions, setScreenDimensions] = useState(
    Dimensions.get('window')
  );
  const [chatStatus, setChatStatus] = useState<ChatStatus>(ChatStatus.Init);
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
  const { sendEvent, event } = useAppContext();
  const sendEventRef = useRef(sendEvent);
  const inputTextRef = useRef('');
  const [hasInputText, setHasInputText] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileInfo[]>([]);
  const selectedFilesRef = useRef(selectedFiles);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const currentScrollOffsetRef = useRef(0);
  const isNewChatRef = useRef(!initialSessionId);
  /** 当前活跃的 ServerClient 实例，未连接时为 null */
  const serverClientRef = useRef<ServerClient | null>(null);
  /** 服务器地址缓存，从 MMKV 加载 */
  const serverAddressRef = useRef(getServerAddress());

  // ==================== Ref 同步 & 副作用 ====================
  /** 每次状态变化后同步到 ref，供异步回调中读取最新值 */
  useEffect(() => {
    messagesRef.current = messages;
    chatStatusRef.current = chatStatus;
  }, [chatStatus, messages]);

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

          client.onStepComplete = (content, thinking) => {
            setMessages((prevMessages) => {
              if (prevMessages.length === 0) {
                return prevMessages;
              }
              const newMessages = [...prevMessages];
              newMessages[0] = {
                ...prevMessages[0],
                text: content || prevMessages[0].text,
                reasoning: thinking || prevMessages[0].reasoning,
              };
              return newMessages;
            });
          };

          client.onComplete = () => {
            trigger(HapticFeedbackTypes.notificationSuccess);
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
      };
    }, [])
  );

  // ==================== 新建聊天 & 导航栏 ====================
  /**
   * 开始新聊天：置空会话 ID，清空消息，然后在服务器上创建新会话。
   * 创建完成后更新 sessionIdRef 并订阅 WebSocket 事件。
   */
  const startNewChat = useRef(
    useCallback(() => {
      trigger(HapticFeedbackTypes.impactMedium);
      sessionIdRef.current = '';
      isNewChatRef.current = true;
      sendEventRef.current('updateHistorySelectedId', { id: '' });

      setMessages([]);

      if (serverClientRef.current && serverAddressRef.current) {
        const agentId = getServerAgentId();
        if (agentId) {
          serverClientRef.current
            .createSession(agentId, serverAddressRef.current)
            .then((newSessionId) => {
              sessionIdRef.current = newSessionId;
              sendEventRef.current('updateHistorySelectedId', {
                id: newSessionId,
              });
              serverClientRef.current?.subscribe(newSessionId);
            })
            .catch((e: Error) => {
              logger.error(`[ChatScreen] createSession failed: ${e.message}`);
            });
        }
      }

      showKeyboard();
    }, [])
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
      sessionIdRef.current = '';

      sendEventRef.current('agentChanged', { id: newAgentId });
    },
    [currentAgentId]
  );

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
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* 陪伴入口按钮：跳转到 Agent 形象页，传递 agentId 和当前会话 ID */}
          <TouchableOpacity
            onPress={() => {
              if (!currentAgentId) {
                return;
              }
              const currentAgent = agents.find((a) => a.id === currentAgentId);
              navigation.navigate('Companion', {
                agentId: currentAgentId,
                sessionId: sessionIdRef.current || undefined,
                voiceId: currentAgent?.voiceId,
              });
            }}
            style={{ paddingVertical: 10, paddingHorizontal: 6 }}
          >
            <UserRound size={22} color={colors.text} />
          </TouchableOpacity>
          <CustomHeaderRightButton
            onPress={() => {
              textInputViewRef?.current?.clear();
              setSelectedFiles([]);
              if (
                messagesRef.current.length > 0 &&
                chatStatusRef.current !== ChatStatus.Running
              ) {
                startNewChat.current();
              }
            }}
            imageSource={
              isDark
                ? require('../assets/edit_dark.png')
                : require('../assets/edit.png')
            }
          />
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
    isDark,
    agents,
    currentAgentId,
    handleSelectAgent,
    // colors.text：陪伴按钮图标颜色依赖主题，主题变化时需重新设置导航栏
    colors.text,
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
      isNewChatRef.current = false;
      setIsLoadingMessages(true);
      sessionIdRef.current = initialSessionId;

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
            session.createdAt
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
  }, [initialSessionId, tapIndex]);

  // ==================== 事件监听 ====================
  /** 监听 AppContext 事件：删除聊天时清空当前会话 */
  useEffect(() => {
    if (event?.event === 'deleteChat' && event.params) {
      const { id } = event.params;
      if (sessionIdRef.current === id) {
        sessionIdRef.current = '';
        sendEventRef.current('updateHistorySelectedId', {
          id: '',
        });
        setMessages([]);
      }
    }
  }, [event]);

  // ==================== 键盘 & 屏幕 & 生命周期 ====================
  /** 键盘弹出时自动滚到底部（仅在输入框聚焦时） */
  useEffect(() => {
    const handleKeyboardShow = () => {
      // Only scroll to bottom if the chat input is focused
      if (textInputViewRef.current?.isFocused()) {
        scrollToBottom();
      }
    };

    const keyboardDidShowListener = Platform.select({
      ios: Keyboard.addListener('keyboardWillShow', handleKeyboardShow),
      android: Keyboard.addListener('keyboardDidShow', handleKeyboardShow),
    });

    return () => {
      keyboardDidShowListener && keyboardDidShowListener.remove();
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
  const { width: screenWidth, height: screenHeight } = screenDimensions;

  const scrollStyle = StyleSheet.create({
    scrollToBottomContainerStyle: {
      width: 30,
      height: 30,
      left:
        Platform.OS === 'ios' &&
        screenHeight < screenWidth &&
        screenHeight < 500
          ? screenWidth / 2 - 75 // iphone landscape
          : screenWidth / 2 - 15,
      bottom: screenHeight > screenWidth ? '1.5%' : '2%',
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
  const onSend = useCallback(async (message: ChatMessage[] = []) => {
    // 发新消息时，重置用户滚动状态，让界面能自动滚到底部
    setUserScrolled(false);
    // 取出当前选中的附件文件
    const files = selectedFilesRef.current;
    // 如果有视频还在转码/压缩中，提示等待
    if (!isAllFileReady(files)) {
      showInfo('please wait for all videos to be ready');
      return;
    }

    if (message[0]?.text || files.length > 0) {
      if (!message[0]?.text) {
        message[0].text = getFileTypeSummary(files);
      }

      if (selectedFilesRef.current.length > 0) {
        message[0].image = JSON.stringify(selectedFilesRef.current);
        setSelectedFiles([]);
      }
      trigger(HapticFeedbackTypes.impactMedium);
      scrollToBottom();

      setChatStatus(ChatStatus.Running);
      setMessages((previousMessages) => [
        createBotMessage(),
        ...GiftedChat.append(previousMessages, message),
      ]);
      const agentId = getServerAgentId();

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
            sessionIdRef.current = sessionId;
            serverClientRef.current!.subscribe(sessionId);
            logger.debug(
              `[ChatScreen] onSend: auto-created session ${sessionId}`
            );
          }
          logger.debug(
            `[ChatScreen] onSend: text="${message[0].text.substring(
              0,
              80
            )}" sessionId=${sessionId}`
          );
          await serverClientRef.current!.sendChatMessage(
            agentId,
            sessionId,
            message[0].text,
            serverAddressRef.current!,
            false
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          logger.error(`[ChatScreen] onSend error: ${errMsg}`);
        }
      })();
    }
  }, []);

  // ==================== 文件 & 语音转录 ====================
  /**
   * 新增附件文件，会检查数量限制后合并到已有文件列表。
   * @param files 用户选中的新文件列表
   */
  const handleNewFileSelected = (files: FileInfo[]) => {
    setSelectedFiles((prevFiles) => {
      return checkFileNumberLimit(prevFiles, files);
    });
  };

  // ==================== UI 渲染 ====================
  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.container}>
      <GiftedChat
        // 消息列表的 ref，用于代码中控制滚动（如 scrollToBottom、编辑时滚动定位）
        messageContainerRef={flatListRef}
        // 输入框的 ref，用于发送后清空输入框、重新聚焦键盘
        textInputRef={textInputViewRef}
        // 点击非可交互区域时收起键盘
        keyboardShouldPersistTaps="never"
        // 底部偏移：处理键盘/底部安全区域的遮挡问题
        // Android 系统自动处理所以为 0；iPhone 竖屏有 Home Indicator 多留 24；其余 12
        bottomOffset={
          Platform.OS === 'android'
            ? 0
            : screenHeight > screenWidth && screenWidth < 500
            ? 24 // iphone in portrait
            : 12
        }
        messages={messages}
        onSend={onSend}
        user={{
          _id: 1,
        }}
        alignTop={false}
        inverted={true}
        /** 空聊天页面：无消息时显示的欢迎界面 */
        renderChatEmpty={() => (
          <EmptyChatComponent isLoadingMessages={isLoadingMessages} />
        )}
        alwaysShowSend={
          chatStatus !== ChatStatus.Init || selectedFiles.length > 0
        }
        /** 自定义输入框：显示普通文本输入框 */
        renderComposer={(props) => (
          <Composer {...props} textInputStyle={styles.composerTextInput} />
        )}
        /** 自定义发送按钮：根据状态切换发送/停止/附件按钮 */
        renderSend={(props) => (
          <CustomSendComponent
            {...props}
            chatStatus={chatStatus}
            selectedFiles={selectedFiles}
            onStopPress={() => {
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
            }}
            onFileSelected={(files) => {
              handleNewFileSelected(files);
            }}
          />
        )}
        /** 自定义底部工具栏：附件文件列表 */
        renderChatFooter={() => (
          <CustomChatFooter
            files={selectedFiles}
            onFileUpdated={(files, isUpdate) => {
              if (isUpdate) {
                setSelectedFiles(files);
              } else {
                handleNewFileSelected(files);
              }
            }}
            hasInputText={hasInputText}
            chatStatus={chatStatus}
          />
        )}
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
            containerHeightRef.current = layoutEvent.nativeEvent.layout.height;
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
        /** 自定义输入框外层容器：控制背景色、边距等样式 */
        renderInputToolbar={(props) => (
          <InputToolbar
            {...props}
            containerStyle={styles.inputToolbarContainer}
            primaryStyle={styles.inputToolbarPrimary}
          />
        )}
        /** 输入框原生属性：键盘回车发送、字体样式、输入变化监听 */
        textInputProps={{
          ...styles.textInputStyle,
          ...{
            fontWeight: 'normal',
            color: colors.text,
            smartInsertDelete: false,
            spellCheck: false,
            onSubmitEditing: () => {
              if (
                inputTextRef.current.length > 0 &&
                chatStatusRef.current !== ChatStatus.Running
              ) {
                const msg: ChatMessage = {
                  text: inputTextRef.current,
                  user: { _id: 1 },
                  createdAt: new Date(),
                  _id: uuid.v4(),
                };
                onSend([msg]);
                inputTextRef.current = '';
                setHasInputText(false);
                textInputViewRef.current?.clear();
                setTimeout(() => {
                  textInputViewRef.current?.clear();
                  textInputViewRef.current?.focus();
                }, 50);
              } else {
                setTimeout(() => {
                  textInputViewRef.current?.focus();
                }, 50);
              }
            },
          },
        }}
        maxComposerHeight={200}
        onInputTextChanged={(text) => {
          inputTextRef.current = text;
          if (!hasInputText && text.length > 0) {
            setHasInputText(true);
          }
          if (hasInputText && text.length === 0) {
            setHasInputText(false);
          }
        }}
      />
    </SafeAreaView>
  );
}

/** 聊天页面的样式工厂，根据当前主题色生成各组件样式 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    /** 整个聊天页面的容器 */
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    /** 消息列表的内容容器，flexGrow + justifyContent 保证消息少时内容在底部 */
    contentContainer: {
      paddingTop: 15,
      paddingBottom: 15,
      flexGrow: 1,
      justifyContent: 'flex-end',
    },
    /** 原生 TextInput 的基础样式 */
    textInputStyle: {
      marginLeft: 10,
      lineHeight: 22,
    },
    /** GiftedChat Composer 内部文本输入框样式 */
    composerTextInput: {
      backgroundColor: 'transparent',
      color: colors.text,
    },
    /** 输入框区域的外层容器，控制背景色和上下内边距 */
    inputToolbarContainer: {
      backgroundColor: colors.background,
      borderTopWidth: 0,
      paddingHorizontal: 10,
      paddingTop: 0,
      paddingBottom: Platform.OS === 'android' ? 8 : 2,
    },
    /** 输入框主区域（圆角背景框） */
    inputToolbarPrimary: {
      backgroundColor: colors.chatInputBackground,
      borderRadius: 12,
      paddingHorizontal: 0,
    },
  });

export default ChatScreen;
