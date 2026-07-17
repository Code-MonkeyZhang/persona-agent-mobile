/**
 * @file ChatScreen.tsx
 * @description 聊天页面主组件，组合 useChatMessages / useChatScroll / useCompanionMode / useKeyboardLayout，
 *   以及 GiftedChat、FloatingInputBar、CompanionContent 等子组件。
 *   本文件负责：agent 数据初始化、会话切换、事件监听、header 配置、slide 动画、渲染编排。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GiftedChat } from 'react-native-gifted-chat';
import {
  Dimensions,
  Image,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import { ColorScheme, useTheme } from '../theme/index.ts';
import CustomMessageComponent from './component/CustomMessageComponent.tsx';
import { CustomScrollToBottomComponent } from './component/CustomScrollToBottomComponent.tsx';
import { EmptyChatComponent } from './component/EmptyChatComponent.tsx';
import AgentSelector from './component/AgentSelector.tsx';
import { HeaderRightButtons } from './component/HeaderRightButtons.tsx';
import { CompanionReplyBubble } from './component/CompanionReplyBubble.tsx';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteParamList } from '../types/RouteTypes.ts';
import {
  getServerAddress,
  getServerAgentId,
  saveServerAgentId,
  getLastSessionId,
} from '../storage/StorageUtils.ts';
import {
  fetchAgents,
  fetchSessionMessages,
  convertToChatMessages,
  getAgentAvatarUrl,
} from '../api/server-api.ts';
import type { AgentInfo } from '../api/server-api.ts';
import * as wsClient from '../api/ws-client.ts';
import { logger } from '../lib/logger';
import { ChatStatus, FileInfo, ChatMessage } from '../types/Chat.ts';
import { useAppContext } from '../history/AppProvider.tsx';
import { trigger } from './util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types';
import FloatingInputBar from './component/FloatingInputBar.tsx';
import CompanionContent from './component/CompanionContent.tsx';
import { checkFileNumberLimit } from './util/FileUtils.ts';
import { useVoiceStore } from '../stores/voiceStore';
import { useSessionStore, extractPreview } from '../stores/sessionStore';
import { useChatScroll } from './hooks/useChatScroll.ts';
import { useKeyboardLayout } from './hooks/useKeyboardLayout.ts';
import { useCompanionMode } from './hooks/useCompanionMode.ts';
import {
  useChatMessages,
  BOT_ID,
  textPlaceholder,
} from './hooks/useChatMessages.ts';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

type ChatScreenRouteProp = RouteProp<RouteParamList, 'Bedrock'>;
type ChatScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Bedrock'
>;

function ChatScreen(): React.JSX.Element {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();
  const initialSessionId = route.params?.sessionId ?? getLastSessionId();
  const tapIndex = route.params?.tapIndex;

  // ==================== 本地状态 ====================
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState(
    getServerAgentId() || ''
  );
  const [selectedFiles, setSelectedFiles] = useState<FileInfo[]>([]);
  const [screenDimensions, setScreenDimensions] = useState(
    Dimensions.get('window')
  );
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [fibWrapperHeight, setFibWrapperHeight] = useState(130);

  // ==================== Refs ====================
  const textInputViewRef = useRef<TextInput>(null);
  const serverAddressRef = useRef(getServerAddress());
  const { sendEvent } = useAppContext();
  const sendEventRef = useRef(sendEvent);
  const selectedFilesRef = useRef(selectedFiles);
  const chatStatusRef = useRef<ChatStatus>(ChatStatus.Init);
  const messagesRef = useRef<ChatMessage[]>([]);
  const currentAgentNameRef = useRef('AI');

  // ==================== voiceStore ====================
  const voiceEnabled = useVoiceStore((s) => s.voiceEnabled);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const speak = useVoiceStore((s) => s.speak);
  const stopSpeaking = useVoiceStore((s) => s.stopSpeaking);
  const voiceEnabledRef = useRef(voiceEnabled);
  const speakRef = useRef(speak);
  const stopSpeakingRef = useRef(stopSpeaking);

  // ==================== Hooks ====================
  const scroll = useChatScroll(chatStatusRef);
  const { keyboardHeight, showKeyboard } = useKeyboardLayout(
    textInputViewRef,
    scroll.scrollToBottom
  );
  const companion = useCompanionMode(
    currentAgentId,
    serverAddressRef,
    stopSpeakingRef
  );
  const chat = useChatMessages({
    scrollToBottom: scroll.scrollToBottom,
    setUserScrolled: scroll.setUserScrolled,
    serverAddressRef,
    currentAgentNameRef,
    companionOpenRef: companion.companionOpenRef,
    voiceEnabledRef,
    speakRef,
    selectedFilesRef,
    setCurrentPose: companion.setCurrentPose,
    setPoseError: companion.setPoseError,
    onFilesConsumed: () => setSelectedFiles([]),
    t,
  });

  // ==================== Ref 同步 ====================
  useEffect(() => {
    messagesRef.current = chat.messages;
    chatStatusRef.current = chat.chatStatus;
    voiceEnabledRef.current = voiceEnabled;
    speakRef.current = speak;
    stopSpeakingRef.current = stopSpeaking;
    currentAgentNameRef.current =
      agents.find((a) => a.id === currentAgentId)?.name ?? 'AI';
  }, [
    chat.messages,
    chat.chatStatus,
    voiceEnabled,
    speak,
    stopSpeaking,
    agents,
    currentAgentId,
  ]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  /** AI 流式输出期间保持屏幕常亮 */
  useEffect(() => {
    if (chat.chatStatus === ChatStatus.Running) {
      activateKeepAwake();
    } else {
      deactivateKeepAwake();
    }
    return () => {
      deactivateKeepAwake();
    };
  }, [chat.chatStatus]);

  // ==================== 数据初始化 ====================
  useFocusEffect(
    React.useCallback(() => {
      const address = getServerAddress();
      if (!address) {
        return;
      }
      serverAddressRef.current = address;

      let cancelled = false;
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
        } catch (e) {
          logger.error(
            `[ChatScreen] init failed: ${e instanceof Error ? e.message : e}`
          );
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [])
  );

  // ==================== 新建聊天 & Agent 切换 ====================
  const startNewChat = useRef(
    useCallback(() => {
      trigger(HapticFeedbackTypes.impactMedium);
      logger.info('[ChatScreen] startNewChat');
      chat.setSessionId('');
      sendEventRef.current('updateHistorySelectedId', { id: '' });
      chat.setMessages([]);
      companion.setCurrentPose('default');
      companion.setPoseError(false);
      showKeyboard();
    }, [chat, companion, showKeyboard])
  );

  const handleSelectAgent = useCallback(
    (newAgentId: string) => {
      if (newAgentId === currentAgentId) {
        return;
      }
      saveServerAgentId(newAgentId);
      setCurrentAgentId(newAgentId);
      chat.setMessages([]);
      chat.setSessionId('');
      stopSpeakingRef.current();
      sendEventRef.current('agentChanged', { id: newAgentId });
      logger.info(
        `[ChatScreen] agent switch → loading chat session for ${newAgentId}`
      );
      navigation.setParams({
        sessionId: `chat-${newAgentId}`,
        tapIndex: Date.now(),
      });
    },
    [currentAgentId, chat, navigation]
  );

  /** 预加载 Agent 头像 */
  useEffect(() => {
    if (!currentAgentId || !serverAddressRef.current) {
      return;
    }
    const url = getAgentAvatarUrl(currentAgentId, serverAddressRef.current);
    Image.prefetch(url)
      .then(() => logger.debug(`[ChatScreen] avatar prefetched: ${url}`))
      .catch((err) => logger.warn('[ChatScreen] avatar prefetch failed:', err));
  }, [currentAgentId]);

  const handleToggleVoice = useCallback(() => {
    toggleVoice();
  }, [toggleVoice]);

  // ==================== Header 配置 ====================
  React.useLayoutEffect(() => {
    navigation.setOptions({
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
        <HeaderRightButtons
          voiceEnabled={voiceEnabled}
          isSpeaking={isSpeaking}
          companionOpen={companion.companionOpen}
          onToggleVoice={handleToggleVoice}
          onToggleCompanion={companion.handleToggleCompanion}
          colors={colors}
        />
      ),
    });
  }, [
    navigation,
    agents,
    currentAgentId,
    handleSelectAgent,
    companion.companionOpen,
    companion.handleToggleCompanion,
    voiceEnabled,
    isSpeaking,
    colors,
    handleToggleVoice,
  ]);

  // ==================== 会话切换 & 消息加载 ====================
  useEffect(() => {
    if (tapIndex && initialSessionId) {
      if (chat.sessionIdRef.current === initialSessionId) {
        return;
      }
      if (chatStatusRef.current === ChatStatus.Running) {
        chatStatusRef.current = ChatStatus.Init;
      }
      setSelectedFiles([]);
      chat.setChatStatus(ChatStatus.Init);
      sendEventRef.current('');
      if (initialSessionId === '' || initialSessionId === '-1') {
        startNewChat.current();
        return;
      }
      chat.setMessages([]);
      setIsLoadingMessages(true);
      chat.setSessionId(initialSessionId);

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
          chat.setMessages(chatMessages);
          const pose = session.currentPose ?? 'default';
          companion.setCurrentPose(pose);
          companion.setPoseError(false);
          logger.debug(`[ChatScreen] session loaded, pose: ${pose}`);
          if (chatMessages.length > 0 && chatMessages[0].text) {
            useSessionStore
              .getState()
              .updateSessionPreview(
                initialSessionId,
                extractPreview(chatMessages[0].text)
              );
          }
          wsClient.subscribe(initialSessionId);
        } catch (e) {
          logger.error(`[ChatScreen] loadSession failed: ${e}`);
        } finally {
          setIsLoadingMessages(false);
          setTimeout(scroll.scrollToBottom, 200);
        }
      })();
    }
  }, [initialSessionId, tapIndex, chat, companion, scroll]);

  // ==================== 事件监听 ====================
  const { event } = useAppContext();
  useEffect(() => {
    if (event?.event === 'newChat') {
      logger.info('[ChatScreen] newChat event received');
      textInputViewRef?.current?.clear();
      setSelectedFiles([]);
      startNewChat.current();
    }
  }, [event]);

  useEffect(() => {
    if (event?.event === 'deleteChat' && event.params) {
      const { id } = event.params;
      if (chat.sessionIdRef.current === id) {
        chat.setSessionId('');
        sendEventRef.current('updateHistorySelectedId', { id: '' });
        chat.setMessages([]);
      }
    }
  }, [event, chat]);

  // ==================== 键盘 & 屏幕 ====================
  useEffect(() => {
    showKeyboard();
  }, [showKeyboard]);

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
  useEffect(() => {
    if (chat.chatStatus === ChatStatus.Complete) {
      if (messagesRef.current.length <= 1) {
        return;
      }
      sendEventRef.current('updateHistory');
      setTimeout(() => {
        sendEventRef.current('updateHistorySelectedId', {
          id: chat.sessionIdRef.current,
        });
      }, 100);
      chat.setChatStatus(ChatStatus.Init);
    }
  }, [chat]);

  // ==================== 文件处理 ====================
  const handleNewFileSelected = useCallback((newFiles: FileInfo[]) => {
    setSelectedFiles((prev) => checkFileNumberLimit(prev, newFiles));
  }, []);

  const handleFileUpdated = useCallback((files: FileInfo[]) => {
    setSelectedFiles(files);
  }, []);

  // ==================== UI 渲染 ====================
  const { width: screenWidth } = screenDimensions;

  const slideTranslateX = useSharedValue(0);
  useEffect(() => {
    slideTranslateX.value = withTiming(
      companion.companionOpen ? -screenDimensions.width : 0,
      { duration: 300, easing: Easing.inOut(Easing.ease) }
    );
  }, [companion.companionOpen, screenDimensions.width, slideTranslateX]);

  const slideAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideTranslateX.value }],
  }));

  const styles = createStyles(colors);

  const scrollStyle = StyleSheet.create({
    scrollToBottomContainerStyle: {
      width: 30,
      height: 30,
      right: 16,
      bottom: fibWrapperHeight + 44,
    },
  });

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
    chatFooterSpacer: {
      height: fibWrapperHeight,
    },
  });

  const lastAgentMessage =
    chat.messages.length > 0 && chat.messages[0].user._id === BOT_ID
      ? chat.messages[0]
      : null;
  const isThinking = lastAgentMessage?.text === textPlaceholder;

  return (
    <View style={styles.container}>
      <View style={styles.contentArea}>
        <Animated.View style={[slideStyle.row, slideAnimatedStyle]}>
          {/* Pane 1: 聊天列表 */}
          <View style={slideStyle.pane}>
            <GiftedChat
              messageContainerRef={scroll.flatListRef}
              keyboardShouldPersistTaps="never"
              messages={chat.messages}
              user={{ _id: 1 }}
              alignTop={false}
              inverted={true}
              isKeyboardInternallyHandled={false}
              minInputToolbarHeight={0}
              minComposerHeight={0}
              renderChatEmpty={() => (
                <EmptyChatComponent isLoadingMessages={isLoadingMessages} />
              )}
              renderChatFooter={() => (
                <View style={slideStyle.chatFooterSpacer} />
              )}
              renderInputToolbar={() => null}
              renderMessage={(props) => {
                const messageIndex = chat.messages.findIndex(
                  (msg) => msg._id === props.currentMessage?._id
                );
                const isLastAIMessage =
                  props.currentMessage?._id === chat.messages[0]?._id &&
                  props.currentMessage?.user._id !== 1;
                return (
                  <CustomMessageComponent
                    {...props}
                    chatStatus={chat.chatStatus}
                    isLastAIMessage={isLastAIMessage}
                    onReasoningToggle={scroll.handleReasoningToggle}
                    messageIndex={messageIndex}
                    flatListRef={scroll.flatListRef}
                    agentId={currentAgentId}
                    serverAddress={serverAddressRef.current}
                  />
                );
              }}
              listViewProps={{
                contentContainerStyle: styles.contentContainer,
                contentInset: { top: 2 },
                onLayout: (layoutEvent: LayoutChangeEvent) => {
                  scroll.containerHeightRef.current =
                    layoutEvent.nativeEvent.layout.height;
                },
                onScrollEvent: scroll.handleScroll,
                onContentSizeChange: (_width: number, height: number) => {
                  scroll.contentHeightRef.current = height;
                },
                onScrollBeginDrag: scroll.handleUserScroll,
                onMomentumScrollEnd: scroll.handleMomentumScrollEnd,
                ...(scroll.userScrolled &&
                chat.chatStatus === ChatStatus.Running &&
                scroll.contentHeightRef.current >
                  scroll.containerHeightRef.current
                  ? {
                      maintainVisibleContentPosition: {
                        minIndexForVisible: 0,
                        autoscrollToTopThreshold: 0,
                      },
                    }
                  : {}),
              }}
              scrollToBottom={true}
              scrollToBottomComponent={() => <CustomScrollToBottomComponent />}
              scrollToBottomStyle={scrollStyle.scrollToBottomContainerStyle}
            />
          </View>
          {/* Pane 2: 陪伴内容 */}
          <Pressable style={slideStyle.pane} onPress={() => Keyboard.dismiss()}>
            <CompanionContent
              agentId={currentAgentId}
              serverAddr={serverAddressRef.current}
              hasAssets={companion.hasAssets}
              currentPose={companion.currentPose}
              bgError={companion.bgError}
              poseError={companion.poseError}
              onBgError={() => companion.setBgError(true)}
              onPoseError={() => companion.setPoseError(true)}
            />
          </Pressable>
        </Animated.View>
      </View>
      {/* FIB 容器：绝对定位浮在内容上方 */}
      <View
        style={styles.fibWrapper}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && h !== fibWrapperHeight) {
            setFibWrapperHeight(h);
          }
        }}
      >
        {/* 陪伴回复气泡 */}
        {companion.companionOpen && lastAgentMessage && (
          <CompanionReplyBubble
            messageKey={lastAgentMessage._id as string}
            text={lastAgentMessage.text}
            isThinking={isThinking}
            thinkingText={t('chat.thinking')}
            colors={colors}
          />
        )}
        {/* BlurView 只覆盖输入框区域 */}
        <BlurView
          style={{
            paddingBottom:
              Platform.OS === 'ios'
                ? Math.max(keyboardHeight, insets.bottom)
                : insets.bottom,
          }}
          blurType="light"
          blurAmount={15}
        >
          <FloatingInputBar
            textInputRef={textInputViewRef}
            onSend={chat.onSend}
            selectedFiles={selectedFiles}
            chatStatus={chat.chatStatus}
            onFileSelected={handleNewFileSelected}
            onFileUpdated={handleFileUpdated}
          />
        </BlurView>
      </View>
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      position: 'relative',
    },
    contentArea: {
      flex: 1,
      overflow: 'hidden',
    },
    fibWrapper: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 20,
    },
    contentContainer: {
      paddingTop: 15,
      paddingBottom: 15,
      flexGrow: 1,
      justifyContent: 'flex-end',
    },
  });

export default ChatScreen;
