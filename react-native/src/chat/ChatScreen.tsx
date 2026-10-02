/**
 * @file ChatScreen.tsx
 * @description 聊天页，从会话主页压栈进入的普通页面，返回即卸载。
 *   组合 useChatScroll / useCompanionMode / useKeyboardLayout，
 *   以及 GiftedChat、FloatingInputBar、CompanionContent 等子组件。
 *   本文件负责：会话切换、header 配置、slide 动画、渲染编排。
 *   消息与生成状态订阅自 chatStore，本组件不持有消息数据，
 *   agent 拉取与启动恢复由会话主页完成。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { ChatHeaderTitle } from './component/ChatHeaderTitle.tsx';
import { SweepIndicator } from './component/SweepIndicator.tsx';
import ConnectionBanner from '../home/ConnectionBanner.tsx';
import { HeaderRightButtons } from './component/HeaderRightButtons.tsx';
import { HeaderLeftButtons } from './component/HeaderLeftButtons.tsx';
import { CompanionReplyBubble } from './component/CompanionReplyBubble.tsx';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteParamList } from '../types/RouteTypes.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import { getAgentAvatarUrl } from '../api/server-api.ts';
import { logger } from '../lib/logger';
import { ChatStatus, FileInfo } from '../types/Chat.ts';
import { trigger } from './util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types';
import FloatingInputBar from './component/FloatingInputBar.tsx';
import CompanionContent from './component/CompanionContent.tsx';
import {
  checkFileNumberLimit,
  getFileTypeSummary,
  isAllFileReady,
} from './util/FileUtils.ts';
import { useVoiceStore } from '../stores/voiceStore';
import { useAppPanelStore } from '../stores/appPanelStore';
import { useSessionStore, NEW_CHAT_SESSION } from '../stores/sessionStore';
import { useChatStore, EMPTY_MESSAGES, BOT_ID } from '../stores/chatStore';
import { useChatScroll } from './hooks/useChatScroll.ts';
import { useKeyboardLayout } from './hooks/useKeyboardLayout.ts';
import { useCompanionMode } from './hooks/useCompanionMode.ts';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

type ChatScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Chat'
>;

type ChatScreenRouteProp = RouteProp<RouteParamList, 'Chat'>;

/** 键盘弹出时输入栏与键盘顶边保留的间距 */
const KEYBOARD_GAP = 8;

function ChatScreen(): React.JSX.Element {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();

  // ==================== 本地状态 ====================
  /** 当前 agent，进页时从 MMKV 读一次，本页存续期间不会变化 */
  const [currentAgentId] = useState(getServerAgentId() || '');
  const [selectedFiles, setSelectedFiles] = useState<FileInfo[]>([]);
  const [screenDimensions, setScreenDimensions] = useState(
    Dimensions.get('window')
  );
  const [fibWrapperHeight, setFibWrapperHeight] = useState(130);

  // ==================== Refs ====================
  const textInputViewRef = useRef<TextInput>(null);
  const serverAddressRef = useRef(getServerAddress());
  const selectedFilesRef = useRef(selectedFiles);
  const chatStatusRef = useRef<ChatStatus>(ChatStatus.Init);
  /** 上一帧消息数量，用于生成期间消息增长时自动滚底 */
  const prevMessageCountRef = useRef(0);

  // ==================== voiceStore ====================
  const voiceEnabled = useVoiceStore((s) => s.voiceEnabled);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);

  // ==================== sessionStore ====================
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionTitles = useSessionStore((s) => s.sessionTitles);

  // ==================== chatStore ====================
  const displayedSessionId = useChatStore((s) => s.displayedSessionId);
  const sessionSlice = useChatStore((s) => s.sessions[s.displayedSessionId]);
  const isLoadingMessages = useChatStore((s) => s.isLoading);
  const messages = sessionSlice?.messages ?? EMPTY_MESSAGES;
  const chatStatus = sessionSlice?.status ?? ChatStatus.Init;
  const currentPose = sessionSlice?.pose ?? 'default';
  const poseError = sessionSlice?.poseError ?? false;

  // ==================== Hooks ====================
  const scroll = useChatScroll(chatStatusRef);
  const { keyboardHeight } = useKeyboardLayout(
    textInputViewRef,
    scroll.scrollToBottom
  );
  const companion = useCompanionMode(currentAgentId, serverAddressRef);

  // ==================== Ref 同步 ====================
  useEffect(() => {
    chatStatusRef.current = chatStatus;
  }, [chatStatus]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  /** AI 流式输出期间保持屏幕常亮 */
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

  // ==================== 会话标题 ====================
  // 新建态取新对话文案，其余会话取热更新补丁优先、进页快照兜底
  const chatTitle = useMemo(() => {
    if (activeSessionId === NEW_CHAT_SESSION) {
      return t('home.newChat');
    }
    return sessionTitles[activeSessionId] ?? route.params?.title ?? '';
  }, [activeSessionId, sessionTitles, route.params?.title, t]);

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

  /**
   * 打开 Agent App 工作区。
   * 有 currentAppId → 恢复上次 App；空 → 进应用网格（与形态与交互的导航模型一致）。
   */
  const handleOpenAgentApp = useCallback(() => {
    const current = useAppPanelStore.getState().currentAppId;
    logger.info(`[ChatScreen] open agent app, currentAppId=${current}`);
    if (current) {
      navigation.navigate('AppSurface');
    } else {
      navigation.navigate('AppLauncher');
    }
  }, [navigation]);

  // ==================== Header 配置 ====================
  React.useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerTitle: () => <ChatHeaderTitle title={chatTitle} />,
      // eslint-disable-next-line react/no-unstable-nested-components
      headerLeft: () => (
        <HeaderLeftButtons
          voiceEnabled={voiceEnabled}
          isSpeaking={isSpeaking}
          onToggleVoice={handleToggleVoice}
          onBack={() => navigation.goBack()}
          colors={colors}
        />
      ),
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <HeaderRightButtons
          companionOpen={companion.companionOpen}
          onToggleCompanion={companion.handleToggleCompanion}
          onOpenAgentApp={handleOpenAgentApp}
          colors={colors}
        />
      ),
    });
  }, [
    navigation,
    chatTitle,
    companion.companionOpen,
    companion.handleToggleCompanion,
    voiceEnabled,
    isSpeaking,
    colors,
    handleToggleVoice,
    handleOpenAgentApp,
  ]);

  // ==================== 会话切换 & 消息加载 ====================
  useEffect(() => {
    // 守卫：正在展示的就是目标会话则跳过。
    // 覆盖新会话拿到真实 id 后回写 activeSessionId 的情形，避免重复加载与死循环
    if (useChatStore.getState().displayedSessionId === activeSessionId) {
      return;
    }
    setSelectedFiles([]);

    // NEW_CHAT_SESSION 表示新建聊天
    if (activeSessionId === NEW_CHAT_SESSION) {
      trigger(HapticFeedbackTypes.impactMedium);
      logger.info('[ChatScreen] startNewChat');
      useChatStore.getState().activateSession(NEW_CHAT_SESSION);
      return;
    }

    let cancelled = false;
    useChatStore
      .getState()
      .activateSession(activeSessionId)
      .finally(() => {
        if (!cancelled) {
          setTimeout(scroll.scrollToBottom, 200);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, scroll]);

  // ==================== 屏幕 ====================
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

  // ==================== 生成期自动滚底 ====================
  // 生成期间消息数量增长（发送与占位气泡插入）时滚到底部，与用户主动上滑互不干扰
  useEffect(() => {
    if (
      chatStatus === ChatStatus.Running &&
      messages.length > prevMessageCountRef.current
    ) {
      scroll.scrollToBottom();
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, chatStatus, scroll]);

  // ==================== 消息发送 ====================
  const handleSend = useCallback(
    (text: string) => {
      const files = selectedFilesRef.current;
      if (!isAllFileReady(files)) {
        return;
      }
      const messageText =
        text || (files.length > 0 ? getFileTypeSummary(files) : '');
      if (!messageText && files.length === 0) {
        return;
      }
      scroll.setUserScrolled(false);
      trigger(HapticFeedbackTypes.impactMedium);
      scroll.scrollToBottom();
      if (files.length > 0) {
        setSelectedFiles([]);
      }
      useChatStore.getState().sendMessage(messageText, files);
    },
    [scroll]
  );

  const handleStop = useCallback(() => {
    useChatStore.getState().stopGeneration();
  }, []);

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

  // 最新 AI 消息用于陪伴气泡与操作按钮判定，生成期间无占位气泡，运行态直接由 chatStatus 表达
  const lastAgentMessage = messages.find((m) => m.user._id === BOT_ID) ?? null;
  const isThinking = chatStatus === ChatStatus.Running;

  return (
    <View style={styles.container}>
      <View style={styles.contentArea}>
        {/* 头部下方状态槽，红蓝绿条在上，生成扫动条在下，绿条亮两秒收起后不占布局 */}
        <ConnectionBanner />
        {chatStatus === ChatStatus.Running && <SweepIndicator />}
        <Animated.View style={[slideStyle.row, slideAnimatedStyle]}>
          {/* Pane 1: 聊天列表 */}
          <View style={slideStyle.pane}>
            <GiftedChat
              messageContainerRef={scroll.flatListRef}
              keyboardShouldPersistTaps="never"
              messages={messages}
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
                const messageIndex = messages.findIndex(
                  (msg) => msg._id === props.currentMessage?._id
                );
                const isLastAIMessage =
                  props.currentMessage?._id === lastAgentMessage?._id &&
                  props.currentMessage?.user._id !== 1;
                return (
                  <CustomMessageComponent
                    {...props}
                    chatStatus={chatStatus}
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
                chatStatus === ChatStatus.Running &&
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
              currentPose={currentPose}
              bgError={companion.bgError}
              poseError={poseError}
              onBgError={() => companion.setBgError(true)}
              onPoseError={() =>
                useChatStore.getState().setPoseError(displayedSessionId, true)
              }
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
                ? Math.max(keyboardHeight + KEYBOARD_GAP, insets.bottom)
                : insets.bottom + (keyboardHeight > 0 ? KEYBOARD_GAP : 0),
          }}
          blurType="light"
          blurAmount={15}
        >
          <FloatingInputBar
            textInputRef={textInputViewRef}
            onSend={handleSend}
            onStop={handleStop}
            selectedFiles={selectedFiles}
            chatStatus={chatStatus}
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
