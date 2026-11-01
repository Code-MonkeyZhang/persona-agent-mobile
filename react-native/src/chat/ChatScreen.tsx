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
import { GiftedChat, type MessageProps } from 'react-native-gifted-chat';
import type { AnimatedList } from 'react-native-gifted-chat/lib/MessagesContainer';
import {
  Dimensions,
  Keyboard,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackdropBlur from '../component/BackdropBlur.tsx';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import { ColorScheme, useTheme } from '../theme/index.ts';
import CustomMessageComponent from './component/CustomMessageComponent.tsx';
import { CustomScrollToBottomComponent } from './component/CustomScrollToBottomComponent.tsx';
import { EmptyChatComponent } from './component/EmptyChatComponent.tsx';
import { ChatHeaderTitle } from './component/ChatHeaderTitle.tsx';
import { LiveStrip } from './component/LiveStrip.tsx';
import ConnectionBanner from '../home/ConnectionBanner.tsx';
import { HeaderRightButtons } from './component/HeaderRightButtons.tsx';
import { HeaderLeftButtons } from './component/HeaderLeftButtons.tsx';
import { CompanionReplyBubble } from './component/CompanionReplyBubble.tsx';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteParamList } from '../types/RouteTypes.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import { cacheDb } from '../storage/cache-db.ts';
import { useMirrorStore } from '../stores/mirrorStore';
import { viewed as wsViewed } from '../api/ws-client.ts';
import { logger } from '../lib/logger';
import { ChatStatus, ChatMessage, FileInfo } from '../types/Chat.ts';
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
import { useSessionStore, NEW_CHAT_SESSION } from '../stores/sessionStore';
import { useChatStore, EMPTY_MESSAGES, BOT_ID } from '../stores/chatStore';
import { useChatScroll } from './hooks/useChatScroll.ts';
import {
  keyboardAvoidanceOf,
  useKeyboardLayout,
} from './hooks/useKeyboardLayout.ts';
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

/** GiftedChat 回到底部按钮的渲染函数，模块级定义避免每次渲染生成新的组件类型 */
const renderScrollToBottom = () => <CustomScrollToBottomComponent />;

/** 消息窗口的初始与扩展尺寸，列表更新成本随总条数线性放大，窗口化后稳定在常数级 */
const MESSAGE_WINDOW_BASE = 300;
const MESSAGE_WINDOW_STEP = 300;

/**
 * 顶栏时间线的统一顶部留位，行档 36 加下描边 1 共 37。
 * 档位无关统一预留，hair 档不因视觉小而少留，open 展开面板盖住内容属明确豁免。
 * 倒置列表里 paddingBottom 映射视觉顶，与桌面 MessageList 的 STRIP_TOP_RESERVE 同规格，两边调整需同步。
 */
const STRIP_TOP_RESERVE = 37;

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
  const [inputBarHeight, setInputBarHeight] = useState(96);
  const [companionBubbleHeight, setCompanionBubbleHeight] = useState(0);

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
  /** 实时角色名，改名或切换 agent 后由 HomeScreen 同步进 store，名字行即时跟随 */
  const agentName = useChatStore((s) => s.agentName);
  const messages = sessionSlice?.messages ?? EMPTY_MESSAGES;
  const chatStatus = sessionSlice?.status ?? ChatStatus.Init;

  // 窗口化的可见消息，完整数组留在 store 作事实源
  const [windowCount, setWindowCount] = useState(MESSAGE_WINDOW_BASE);
  const visibleMessages = useMemo(
    () => messages.slice(0, windowCount),
    [messages, windowCount]
  );

  const currentPose = sessionSlice?.pose ?? 'default';
  const poseError = sessionSlice?.poseError ?? false;

  // ==================== Hooks ====================
  const scroll = useChatScroll(chatStatusRef);
  const { keyboardBottomStyle, keyboardHeight } = useKeyboardLayout(
    textInputViewRef,
    scroll.scrollToBottom,
    insets.bottom
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

  const handleToggleVoice = useCallback(() => {
    toggleVoice();
  }, [toggleVoice]);

  /** 打开小手机桌面 */
  const handleOpenAgentApp = useCallback(() => {
    logger.info('[ChatScreen] open phone launcher');
    navigation.navigate('AppLauncher');
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
    setWindowCount(MESSAGE_WINDOW_BASE);

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

  // ==================== 会话切换 & 消息加载 ====================
  /**
   * 前台会话的未读上报。
   * 前台且带未读即发送 viewed,单一入口覆盖进入会话与广播置位两种来源,
   * 镜像版本驱动补发,重连追平后未读仍在即再报,服务端幂等空写无副作用。
   */
  const mirrorVersion = useMirrorStore((s) => s.version);
  useEffect(() => {
    if (!activeSessionId || activeSessionId === NEW_CHAT_SESSION) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const meta = await cacheDb.getSessionMeta(activeSessionId);
        if (!cancelled && meta?.hasUnread) {
          wsViewed(activeSessionId);
          logger.info(`[ChatScreen] session viewed: ${activeSessionId}`);
        }
      } catch (e) {
        logger.warn(`[ChatScreen] viewed check failed: ${e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, mirrorVersion]);

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
      setWindowCount(MESSAGE_WINDOW_BASE);
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
      setWindowCount(MESSAGE_WINDOW_BASE);
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

  // 底部浮层总高度，输入栏本体加避让量加陪伴气泡，供列表占位与回底按钮定位，事件时刻一次跳变
  const overlayHeight =
    inputBarHeight +
    companionBubbleHeight +
    keyboardAvoidanceOf(keyboardHeight, insets.bottom);

  const scrollStyle = StyleSheet.create({
    scrollToBottomContainerStyle: {
      width: 30,
      height: 30,
      right: 16,
      bottom: overlayHeight + 44,
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
      height: overlayHeight,
    },
  });

  // 最新 AI 消息用于陪伴气泡与操作按钮判定，生成期间无占位气泡，运行态直接由 chatStatus 表达
  const lastAgentMessage = messages.find((m) => m.user._id === BOT_ID) ?? null;
  const isThinking = chatStatus === ChatStatus.Running;

  /** 传给 GiftedChat 的渲染函数引用固定，避免 ChatScreen 渲染时穿透列表内部缓存 */
  const renderChatEmpty = useCallback(
    () => <EmptyChatComponent isLoadingMessages={isLoadingMessages} />,
    [isLoadingMessages]
  );
  const chatFooterSpacerStyle = slideStyle.chatFooterSpacer;
  const renderChatFooter = useCallback(
    () => <View style={chatFooterSpacerStyle} />,
    [chatFooterSpacerStyle]
  );
  const renderInputToolbar = useCallback(() => null, []);
  const renderMessage = useCallback(
    (props: MessageProps<ChatMessage>) => {
      const isLastAIMessage =
        props.currentMessage?._id === lastAgentMessage?._id &&
        props.currentMessage?.user._id !== 1;
      return (
        <CustomMessageComponent
          {...props}
          chatStatus={chatStatus}
          isLastAIMessage={isLastAIMessage}
          onReasoningToggle={scroll.handleReasoningToggle}
          agentId={currentAgentId}
          agentName={agentName}
          serverAddress={serverAddressRef.current}
        />
      );
    },
    [
      lastAgentMessage,
      chatStatus,
      scroll.handleReasoningToggle,
      currentAgentId,
      agentName,
      serverAddressRef,
    ]
  );

  // 陪伴气泡卸载后归零量高，避免残留值虚增浮层占位
  const companionBubbleVisible = companion.companionOpen && !!lastAgentMessage;
  useEffect(() => {
    if (!companionBubbleVisible) {
      setCompanionBubbleHeight(0);
    }
  }, [companionBubbleVisible]);

  return (
    <View style={styles.container}>
      <View style={styles.contentArea}>
        {/* 头部下方状态槽，横幅浮层盖顶不占布局，层级压过时间线，时间线让位到其下方 */}
        <View style={styles.bannerOverlay}>
          <ConnectionBanner />
        </View>
        <LiveStrip />
        <Animated.View style={[slideStyle.row, slideAnimatedStyle]}>
          {/* Pane 1: 聊天列表 */}
          <View style={slideStyle.pane}>
            <GiftedChat
              messagesContainerRef={
                // 库声明不接纳空值引用，创建引用时初始值必为空，此处仅收窄空值差异
                scroll.flatListRef as React.RefObject<AnimatedList<ChatMessage>>
              }
              messages={visibleMessages}
              loadEarlierMessagesProps={{
                isAvailable: messages.length > windowCount,
                isLoading: false,
                onPress: () => {
                  const next = windowCount + MESSAGE_WINDOW_STEP;
                  setWindowCount(next);
                  logger.info(
                    `[ChatScreen] window expanded, from=${windowCount} to=${next} total=${messages.length}`
                  );
                },
                label: t('chat.loadEarlier'),
              }}
              user={{ _id: 1 }}
              isAlignedTop={false}
              isInverted={true}
              minInputToolbarHeight={0}
              minComposerHeight={0}
              renderChatEmpty={renderChatEmpty}
              renderChatFooter={renderChatFooter}
              renderInputToolbar={renderInputToolbar}
              renderMessage={renderMessage}
              listProps={{
                // 会话消息上万，收紧虚拟化窗口，减少常驻挂载行数，降低每次消息更新的重渲染量
                initialNumToRender: 12,
                maxToRenderPerBatch: 12,
                windowSize: 11,
                contentContainerStyle: styles.contentContainer,
                contentInset: { top: 2 },
                keyboardShouldPersistTaps: 'never',
                onLayout: (layoutEvent: LayoutChangeEvent) => {
                  scroll.containerHeightRef.current =
                    layoutEvent.nativeEvent.layout.height;
                },
                onScroll: scroll.handleScroll,
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
              renderDay={
                // 隐藏不同日期消息之间的日期分隔条
                () => null
              }
              keyboardAvoidingViewProps={
                // 库内置键盘避让与页面外层的官方避让重复，关闭库内置这份
                { enabled: false }
              }
              isDayAnimationEnabled={
                // 日期浮动胶囊在每次消息更新时全量扫描所有消息，上万条会话下堵塞 JS 线程，这里关闭
                false
              }
              isScrollToBottomEnabled={true}
              scrollToBottomComponent={renderScrollToBottom}
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
      <View style={styles.fibWrapper}>
        {/* 陪伴回复气泡 */}
        {companionBubbleVisible && lastAgentMessage && (
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && h !== companionBubbleHeight) {
                setCompanionBubbleHeight(h);
              }
            }}
          >
            <CompanionReplyBubble
              messageKey={lastAgentMessage._id as string}
              text={lastAgentMessage.text}
              isThinking={isThinking}
              thinkingText={t('chat.thinking')}
              colors={colors}
            />
          </View>
        )}
        {/* 底部避让容器由键盘钩子驱动，模糊背景铺满含避让区在内的整个容器，安卓为半透明降级底色 */}
        <Animated.View style={keyboardBottomStyle}>
          <BackdropBlur />
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && h !== inputBarHeight) {
                setInputBarHeight(h);
              }
            }}
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
          </View>
        </Animated.View>
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
    bannerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 30,
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
      paddingBottom: 15 + STRIP_TOP_RESERVE,
      flexGrow: 1,
      justifyContent: 'flex-end',
    },
  });

export default ChatScreen;
