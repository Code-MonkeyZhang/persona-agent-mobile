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
} from 'react-native';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import { ColorScheme, useTheme } from '../theme';
import CustomMessageComponent from './component/CustomMessageComponent.tsx';
import { CustomScrollToBottomComponent } from './component/CustomScrollToBottomComponent.tsx';
import { EmptyChatComponent } from './component/EmptyChatComponent.tsx';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import uuid from 'uuid';
import { RouteParamList } from '../types/RouteTypes.ts';
import {
  getServerAddress,
  getServerAgentId,
  saveServerAgentId,
} from '../storage/StorageUtils.ts';
import {
  NanoAgentClient,
  fetchAgents,
  fetchSessionMessages,
  convertToSwiftChatMessages,
} from '../api/nano-agent-api.ts';
import {
  ChatStatus,
  FileInfo,
  SwiftChatMessage,
  Usage,
} from '../types/Chat.ts';
import { useAppContext } from '../history/AppProvider.tsx';
import { CustomHeaderRightButton } from './component/CustomHeaderRightButton.tsx';
import CustomSendComponent from './component/CustomSendComponent.tsx';
import { trigger } from './util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import { isMac } from '../App.tsx';
import { CustomChatFooter } from './component/CustomChatFooter.tsx';
import {
  checkFileNumberLimit,
  getFileTypeSummary,
  isAllFileReady,
} from './util/FileUtils.ts';
import HeaderTitle from './component/HeaderTitle.tsx';
import { showInfo } from './util/ToastUtils.ts';
import { HeaderOptions } from '@react-navigation/elements';

const BOT_ID = 2;

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
const textPlaceholder = '...';
type ChatScreenRouteProp = RouteProp<RouteParamList, 'Bedrock'>;

// 聊天页面主组件：管理消息收发、AI 流式输出、语音聊天、文件上传等
function ChatScreen(): React.JSX.Element {
  // ==================== 路由参数 ====================
  const { colors, isDark } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<ChatScreenRouteProp>();
  const initialSessionId = route.params?.sessionId;
  const tapIndex = route.params?.tapIndex;

  // ==================== 状态声明 ====================
  const [messages, setMessages] = useState<SwiftChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [screenDimensions, setScreenDimensions] = useState(
    Dimensions.get('window')
  );
  const [chatStatus, setChatStatus] = useState<ChatStatus>(ChatStatus.Init);
  const [usage, setUsage] = useState<Usage>();
  const [userScrolled, setUserScrolled] = useState(false);
  const chatStatusRef = useRef(chatStatus);
  const messagesRef = useRef(messages);
  const flatListRef = useRef<FlatList<SwiftChatMessage>>(null);
  const textInputViewRef = useRef<TextInput>(null);
  /** 服务器会话 UUID，空字符串表示尚未创建 */
  const sessionIdRef = useRef(initialSessionId || '');
  const { sendEvent, event, drawerType } = useAppContext();
  const sendEventRef = useRef(sendEvent);
  const inputTextRef = useRef('');
  const [hasInputText, setHasInputText] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileInfo[]>([]);
  const selectedFilesRef = useRef(selectedFiles);
  const usageRef = useRef(usage);
  const drawerTypeRef = useRef(drawerType);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const currentScrollOffsetRef = useRef(0);
  const isNewChatRef = useRef(!initialSessionId);
  /** 当前活跃的 NanoAgentClient 实例，未连接时为 null */
  const nanoAgentRef = useRef<NanoAgentClient | null>(null);
  /** 服务器地址缓存，从 MMKV 加载 */
  const serverAddressRef = useRef(getServerAddress());

  // ==================== Ref 同步 & 副作用 ====================
  // update refs value with state
  useEffect(() => {
    messagesRef.current = messages;
    chatStatusRef.current = chatStatus;
    usageRef.current = usage;
  }, [chatStatus, messages, usage]);

  // Keep screen awake during streaming output
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
    drawerTypeRef.current = drawerType;
  }, [drawerType]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  // ==================== Nano-Agent 初始化 ====================
  /**
   * 屏幕获得焦点时初始化 NanoAgentClient。
   * 使用 useFocusEffect 而非 useEffect，确保从设置页返回后能重新检测。
   *
   * 流程：读取服务器地址 → 获取 agent → 注册回调 → connect → 存入 nanoAgentRef。
   * 离开屏幕时自动 disconnect 并置空 ref。
   */
  useFocusEffect(
    React.useCallback(() => {
      const address = getServerAddress();
      console.log(
        `[ChatScreen] nano-agent init (focus), serverAddress="${address}"`
      );

      if (nanoAgentRef.current) {
        console.log('[ChatScreen] nano-agent already connected, skip');
        return;
      }

      if (!address) {
        return;
      }
      serverAddressRef.current = address;

      let cancelled = false;
      const client = new NanoAgentClient();

      (async () => {
        try {
          let agentId = getServerAgentId();
          if (!agentId) {
            console.log('[ChatScreen] no cached agentId, fetching agents...');
            const agents = await fetchAgents(address);
            if (cancelled || agents.length === 0) {
              return;
            }
            agentId = agents[0].id;
            saveServerAgentId(agentId);
          }
          console.log(`[ChatScreen] using agentId=${agentId}`);

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
          nanoAgentRef.current = client;
          console.log('[ChatScreen] nano-agent client ready');
        } catch (e) {
          console.log(
            `[ChatScreen] nano-agent init failed: ${
              e instanceof Error ? e.message : e
            }`
          );
        }
      })();

      return () => {
        cancelled = true;
        client.disconnect();
        nanoAgentRef.current = null;
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
      setUsage(undefined);

      if (nanoAgentRef.current && serverAddressRef.current) {
        const agentId = getServerAgentId();
        if (agentId) {
          nanoAgentRef.current
            .createSession(agentId, serverAddressRef.current)
            .then((newSessionId) => {
              sessionIdRef.current = newSessionId;
              sendEventRef.current('updateHistorySelectedId', {
                id: newSessionId,
              });
              nanoAgentRef.current?.subscribe(newSessionId);
            })
            .catch((e: Error) => {
              console.log(`[ChatScreen] createSession failed: ${e.message}`);
            });
        }
      }

      showKeyboard();
    }, [])
  );

  // header text and right button click
  React.useLayoutEffect(() => {
    const headerOptions: HeaderOptions = {
      // eslint-disable-next-line react/no-unstable-nested-components
      headerTitle: () => (
        <HeaderTitle title={'Chat'} usage={usage} onDoubleTap={scrollToTop} />
      ),
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <CustomHeaderRightButton
          onPress={() => {
            //clear input content and selected files
            textInputViewRef?.current?.clear();
            setUsage(undefined);
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
      ),
    };
    navigation.setOptions(headerOptions);
  }, [usage, navigation, isDark]);

  // ==================== 会话切换 & 消息加载 ====================
  // sessionId changes (start new chat or click another session)
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
      setUsage(undefined);
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
          const swiftMessages = convertToSwiftChatMessages(
            session.messages,
            session.createdAt
          );
          setMessages(swiftMessages);
          nanoAgentRef.current?.subscribe(initialSessionId);
        } catch (e) {
          console.log(`[ChatScreen] loadSession failed: ${e}`);
        } finally {
          setIsLoadingMessages(false);
          if (isMac) {
            scrollToBottom();
          } else {
            setTimeout(scrollToBottom, 200);
          }
        }
      })();
    }
  }, [initialSessionId, tapIndex]);

  // ==================== 事件监听 ====================
  // deleteChat listener
  useEffect(() => {
    if (event?.event === 'deleteChat' && event.params) {
      const { id } = event.params;
      if (sessionIdRef.current === id) {
        sessionIdRef.current = '';
        sendEventRef.current('updateHistorySelectedId', {
          id: '',
        });
        setUsage(undefined);
        setMessages([]);
      }
    }
  }, [event]);

  // ==================== 键盘 & 屏幕 & 生命周期 ====================
  // keyboard show listener for scroll to bottom
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

  // show keyboard for open the app
  useEffect(() => {
    showKeyboard();
  }, []);

  const showKeyboard = () => {
    setTimeout(() => {
      textInputViewRef.current?.focus();
    }, 100);
  };

  // update screenWith and height when screen rotate
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
  // handle message complete — 通知 drawer 刷新列表
  useEffect(() => {
    if (chatStatus === ChatStatus.Complete) {
      if (messagesRef.current.length <= 1) {
        return;
      }
      if (drawerTypeRef.current === 'permanent') {
        sendEventRef.current('updateHistory');
        setTimeout(() => {
          sendEventRef.current('updateHistorySelectedId', {
            id: sessionIdRef.current,
          });
        }, 100);
      }
      // Notify Mermaid renderers to refresh after streaming completes
      setTimeout(() => {
        sendEventRef.current('refreshMermaid');
      }, 150);
      setChatStatus(ChatStatus.Init);
    }
  }, [chatStatus]);

  // app goes to background — 不再保存消息（server-first）
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => {});
    return () => {
      subscription.remove();
    };
  }, []);

  // ==================== 滚动控制 ====================
  const { width: screenWidth, height: screenHeight } = screenDimensions;

  const chatScreenWidth =
    isMac && drawerType === 'permanent' ? screenWidth - 300 : screenWidth;

  const scrollStyle = StyleSheet.create({
    scrollToBottomContainerStyle: {
      width: 30,
      height: 30,
      left:
        Platform.OS === 'ios' &&
        screenHeight < screenWidth &&
        screenHeight < 500
          ? screenWidth / 2 - 75 // iphone landscape
          : chatScreenWidth / 2 - 15,
      bottom: screenHeight > screenWidth ? '1.5%' : '2%',
    },
  });

  const scrollToTop = () => {
    setUserScrolled(true);
    if (flatListRef.current) {
      if (messagesRef.current.length > 0) {
        flatListRef.current.scrollToIndex({
          index: messagesRef.current.length - 1,
          animated: true,
        });
      }
    }
  };
  const scrollToBottom = () => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  };

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

  const handleScroll = (
    scrollEvent: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    currentScrollOffsetRef.current = scrollEvent.nativeEvent.contentOffset.y;
  };

  const handleUserScroll = (_: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (chatStatusRef.current === ChatStatus.Running) {
      setUserScrolled(true);
    }
  };

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

  // Stable callback for reasoning toggle - avoids re-render of CustomMessageComponent
  const handleReasoningToggle = useCallback(
    (expanded: boolean, height: number, animated: boolean) => {
      scrollUpByHeight(expanded, height, animated);
    },
    []
  );

  // ==================== 发送消息 & 重新生成 ====================
  /** 重新生成：从指定用户消息重新发起 AI 回复，支持编辑后重发 */
  const regenerateFromUserMessage = useCallback(
    (userMessageIndex: number, newText?: string) => {
      setUserScrolled(false);
      trigger(HapticFeedbackTypes.impactMedium);

      const historyMessages = messagesRef.current.slice(userMessageIndex + 1);

      const userMessage: SwiftChatMessage = newText
        ? { ...messagesRef.current[userMessageIndex], text: newText }
        : messagesRef.current[userMessageIndex];

      setChatStatus(ChatStatus.Running);
      setMessages((_previousMessages) => [
        createBotMessage(),
        userMessage,
        ...historyMessages,
      ]);
      scrollToBottom();

      if (nanoAgentRef.current && serverAddressRef.current) {
        const agentId = getServerAgentId();
        (async () => {
          try {
            let sessionId = sessionIdRef.current;
            if (!sessionId) {
              sessionId = await nanoAgentRef.current!.createSession(
                agentId,
                serverAddressRef.current!
              );
              sessionIdRef.current = sessionId;
              nanoAgentRef.current!.subscribe(sessionId);
            }
            const regeneratedText = newText ?? userMessage.text;
            await nanoAgentRef.current!.sendChatMessage(
              agentId,
              sessionId,
              regeneratedText,
              serverAddressRef.current!
            );
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setMessages((prevMessages) => {
              if (prevMessages.length === 0) {
                return prevMessages;
              }
              const newMessages = [...prevMessages];
              newMessages[0] = {
                ...prevMessages[0],
                text: 'Error: ' + errMsg,
              };
              return newMessages;
            });
            setChatStatus(ChatStatus.Complete);
          }
        })();
      }
    },
    []
  );

  /** 发送消息：构造用户消息，附带文件，插入 AI 占位消息以触发流式回复 */
  const onSend = useCallback(async (message: SwiftChatMessage[] = []) => {
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
            console.log(
              '[ChatScreen] onSend: no server session, auto-creating...'
            );
            sessionId = await nanoAgentRef.current!.createSession(
              agentId,
              serverAddressRef.current!
            );
            sessionIdRef.current = sessionId;
            nanoAgentRef.current!.subscribe(sessionId);
            console.log(
              `[ChatScreen] onSend: auto-created session ${sessionId}`
            );
          }
          console.log(
            `[ChatScreen] onSend (nano-agent): text="${message[0].text.substring(
              0,
              80
            )}" sessionId=${sessionId}`
          );
          await nanoAgentRef.current!.sendChatMessage(
            agentId,
            sessionId,
            message[0].text,
            serverAddressRef.current!
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.log(`[ChatScreen] onSend nano-agent error: ${errMsg}`);
          setMessages((prevMessages) => {
            if (prevMessages.length === 0) {
              return prevMessages;
            }
            const newMessages = [...prevMessages];
            newMessages[0] = {
              ...prevMessages[0],
              text: 'Error: ' + errMsg,
            };
            return newMessages;
          });
          setChatStatus(ChatStatus.Complete);
        }
      })();
    }
  }, []);

  // ==================== 文件 & 语音转录 ====================
  // NOTE: 这个需要留着, 虽然MVP可能暂时用不上
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
              regenerateFromUserMessage={regenerateFromUserMessage}
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
            fontWeight: isMac ? '300' : 'normal',
            color: colors.text,
            smartInsertDelete: false,
            spellCheck: false,
            blurOnSubmit: isMac,
            onSubmitEditing: () => {
              if (
                inputTextRef.current.length > 0 &&
                chatStatusRef.current !== ChatStatus.Running
              ) {
                const msg: SwiftChatMessage = {
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
        maxComposerHeight={isMac ? 360 : 200}
        onInputTextChanged={(text) => {
          if (
            isMac &&
            text.length > 0 &&
            (text[text.length - 1] === '\n' ||
              text.length - 1 === inputTextRef.current.length)
          ) {
            setTimeout(() => {
              textInputViewRef.current?.focus();
            }, 50);
          }
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

// 聊天页面的样式定义（页面背景、输入框区域等）
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    contentContainer: {
      paddingTop: 15,
      paddingBottom: 15,
      flexGrow: 1,
      justifyContent: 'flex-end',
    },
    textInputStyle: {
      marginLeft: 10,
      lineHeight: 22,
    },
    composerTextInput: {
      backgroundColor: 'transparent',
      color: colors.text,
    },
    inputToolbarContainer: {
      backgroundColor: colors.background,
      borderTopWidth: 0,
      paddingHorizontal: 10,
      paddingTop: 0,
      paddingBottom: isMac ? 10 : Platform.OS === 'android' ? 8 : 2,
    },
    inputToolbarPrimary: {
      backgroundColor: colors.chatInputBackground,
      borderRadius: 12,
      paddingHorizontal: 0,
    },
  });

export default ChatScreen;
