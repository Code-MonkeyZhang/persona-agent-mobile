/**
 * @file home/HomeScreen.tsx
 * @description 会话主页，应用首屏。
 *   顶部固定区从上到下是圆钮行、agent 横向条、分隔线、连接横幅与淡阴影，不随列表滚动。
 *   圆钮行避让状态栏，滚动区从聊天入口开始，列表底部避让 home indicator。
 *   agent 拉取与当前 agent 确定与启动会话恢复在连接建立后完成。
 *   agent 横向条的头像在名下会话运行期间外挂全圈呼吸运行圈，数据来自运行族广播的 runningAgents。
 *   Chat 是压栈页，点聊天入口或会话行进入，返回即回到本页。
 *   长相基准是 demo 第三轮的 HomePage，横滑交互走原生 ScrollView。
 *   字号与次级文字颜色及会话行缩进经用户确认有意偏离 demo 基准，不作为对齐缺陷回改。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ChevronRight,
  MessageCircle,
  MessagesSquare,
  MonitorSmartphone,
  Plus,
  Settings,
  Sparkles,
  Wrench,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { ColorScheme, typography, useTheme } from '../theme/index.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import {
  type AgentInfo,
  chatSessionIdFor,
  deleteSession,
  isChatSession,
  noteAgentHashes,
} from '../api/server-api.ts';
import { cacheDb } from '../storage/cache-db.ts';
import { agentsSync } from '../storage/sync-setup';
import {
  getLastConversation,
  getServerAddress,
  getServerAgentId,
  saveLastConversation,
  saveServerAgentId,
} from '../storage/StorageUtils.ts';
import { trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';
import { logger } from '../lib/logger';
import { useSessionStore, NEW_CHAT_SESSION } from '../stores/sessionStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useChatStore } from '../stores/chatStore';
import { useMirrorStore } from '../stores/mirrorStore';
import { Chat, ChatStatus } from '../types/Chat.ts';
import { SignalSlot } from '../component/SignalSlot.tsx';
import AgentAvatar from '../chat/component/AgentAvatar.tsx';
import SessionListItem from '../history/SessionListItem.tsx';
import ConnectionBanner from './ConnectionBanner.tsx';
import FirstLaunchView from '../device/FirstLaunchView.tsx';

type HomeScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Home'
>;

/** 列表头部属性：聊天入口预览文本、信号位两信号与打开回调 */
interface HomeListHeaderProps {
  preview: string;
  /** 聊天会话运行中标志 */
  running: boolean;
  /** 聊天会话未读标志,前台会话的抑制由父级传入前完成 */
  unread: boolean;
  onOpenChat: () => void;
}

/**
 * 列表头部：聊天入口卡、工具与技能入口、会话区标题。
 * 经 memo 固化，会话行展开态变化不再触发这块头部重渲染，滑动动画不被 JS 线程挤帧。
 */
const HomeListHeader = React.memo(function ({
  preview,
  running,
  unread,
  onOpenChat,
}: HomeListHeaderProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const navigation = useNavigation<HomeScreenNavigationProp>();

  return (
    <View>
      {/* 常驻聊天入口，续聊当前 agent 最近会话，只留按压反馈 */}
      <TouchableOpacity
        style={styles.chatCard}
        activeOpacity={0.7}
        onPress={onOpenChat}
      >
        <MessageCircle
          size={20}
          color={colors.textSecondary}
          style={styles.chatCardIcon}
        />
        <View style={styles.chatTextContainer}>
          <Text style={styles.chatCardText}>{t('home.chat')}</Text>
          <Text style={styles.chatPreview} numberOfLines={1}>
            {preview}
          </Text>
        </View>
        {/* 信号位贴卡片右上角,与图标同做 3px 光学补偿 */}
        <SignalSlot
          running={running}
          unread={unread}
          style={styles.chatCardSignal}
        />
      </TouchableOpacity>
      <View style={styles.divider} />
      {/* 工具与技能入口行，点入 AgentNav 对应视图，与会话行同为 20px 文字与 20px 图标档 */}
      <TouchableOpacity
        style={styles.navEntryRow}
        activeOpacity={0.7}
        onPress={() => {
          logger.info('[Home] open agent nav: tools');
          navigation.navigate('AgentNav', { view: 'tools' });
        }}
      >
        <Wrench size={20} color={colors.textSecondary} />
        <Text style={styles.navEntryText}>{t('nav.titleTools')}</Text>
        <ChevronRight size={16} color={colors.textTertiary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navEntryRow}
        activeOpacity={0.7}
        onPress={() => {
          logger.info('[Home] open agent nav: skills');
          navigation.navigate('AgentNav', { view: 'skills' });
        }}
      >
        <Sparkles size={20} color={colors.textSecondary} />
        <Text style={styles.navEntryText}>{t('nav.titleSkills')}</Text>
        <ChevronRight size={16} color={colors.textTertiary} />
      </TouchableOpacity>
      {/* 会话区标题行并入导航组，新建入口已迁至右上角圆钮 */}
      <View style={styles.sessionsHeader}>
        <MessagesSquare size={20} color={colors.textSecondary} />
        <Text style={styles.sessionsHeaderText}>{t('home.sessions')}</Text>
      </View>
    </View>
  );
});

const HomeScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  /** 安全区尺寸，固定区顶部与列表底部只做避让 */
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  // ==================== 本地状态 ====================
  /** 竖栏的 agent 列表，镜像重读驱动，冷启动即有值 */
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState(
    getServerAgentId() || ''
  );
  /** 会话列表，常驻聊天会话不进列表 */
  const [chatHistory, setChatHistory] = useState<Chat[]>([]);
  /** 服务端返回的常驻聊天会话预览，拉取列表时更新 */
  const [chatLastMessage, setChatLastMessage] = useState<string | undefined>(
    undefined
  );
  /** 聊天会话的未读标记，镜像重读时随元信息携带 */
  const [chatUnread, setChatUnread] = useState(false);
  const [unreadAgentIds, setUnreadAgentIds] = useState<string[]>([]);
  /** 启动恢复只执行一次的守卫 */
  const hasRestoredRef = useRef(false);

  // ==================== store ====================
  const sessionPreviews = useSessionStore((s) => s.sessionPreviews);
  const sessionTitles = useSessionStore((s) => s.sessionTitles);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const mirrorVersion = useMirrorStore((s) => s.version);
  const serverAddress = useConnectionStore((s) => s.serverAddress);
  const connectionStatus = useConnectionStore((s) => s.status);
  const reconnectVersion = useConnectionStore((s) => s.reconnectVersion);
  const hostVersion = useConnectionStore((s) => s.hostVersion);
  const deviceCount = useDeviceStore((s) => s.devices.length);

  /** 当前 Agent 的常驻聊天会话 ID，复用于高亮与预览查找 */
  const currentChatSessionId = chatSessionIdFor(currentAgentId);
  /** 聊天入口的末句预览，本地实时补丁优先，服务端 lastMessage 兜底 */
  const chatEntryPreview =
    sessionPreviews[currentChatSessionId] ||
    chatLastMessage ||
    t('home.startChat');
  /** 聊天入口的运行腿取全局广播集合,本机状态兜底,信号位收敛运行与未读两信号 */
  const chatRunning = useChatStore(
    (s) =>
      s.runningSessions.includes(currentChatSessionId) ||
      s.sessions[currentChatSessionId]?.status === ChatStatus.Running
  );
  const chatOnStage = useChatStore(
    (s) => s.displayedSessionId === currentChatSessionId
  );
  /** 运行中 Agent 集合，agent 横向条的头像运行圈据此起转停转 */
  const runningAgentIds = useChatStore((s) => s.runningAgents);

  // ==================== 列表与卡片拉取 ====================
  /** 从镜像库读会话列表，常驻聊天会话只取其预览不进列表，数据源不依赖网络 */
  const handleUpdateHistory = useCallback(async () => {
    const agentId = getServerAgentId();
    if (!agentId) {
      return;
    }
    try {
      const sessions = await cacheDb.listSessions(agentId);
      const chatList: Chat[] = sessions
        .filter((s) => !isChatSession(s.id))
        .map((s) => ({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          hasUnread: s.hasUnread,
        }));
      setChatHistory(chatList);
      const chatSession = sessions.find((s) => isChatSession(s.id));
      setChatLastMessage(chatSession?.lastMessage);
      setChatUnread(Boolean(chatSession?.hasUnread));

      const unreadAgents = await cacheDb.listUnreadAgentIds();
      setUnreadAgentIds(unreadAgents);
      logger.info(`[Home] unread agents: ${unreadAgents.length}`);
    } catch (e) {
      logger.warn(`[Home] session list reload failed: ${e}`);
    }
  }, []);

  // ==================== agent 初始化与启动恢复 ====================
  useEffect(() => {
    logger.info('[Home] mounted');
  }, []);

  /** 安全区尺寸随设备与朝向变化，值变化时打日志供布局问题排查 */
  useEffect(() => {
    logger.info(
      `[Home] safe insets: top=${insets.top} bottom=${insets.bottom}`
    );
  }, [insets.top, insets.bottom]);

  /** 主机接管后复位启动恢复守卫，下轮镜像重读时重走 agent 落位与会话恢复 */
  useEffect(() => {
    if (hostVersion === 0) {
      return;
    }
    logger.info(`[Home] host switched, hostVersion=${hostVersion}`);
    hasRestoredRef.current = false;
  }, [hostVersion]);

  /**
   * 确定当前 agent 并执行一次启动恢复，镜像重读驱动。
   * 上次 Agent 还在且会话非空则恢复上次会话，否则兜底到常驻聊天。
   */
  const settleCurrentAgent = useCallback(
    (list: AgentInfo[]) => {
      let agentId = getServerAgentId();
      if (!agentId || !list.some((a) => a.id === agentId)) {
        agentId = list[0].id;
      }
      saveServerAgentId(agentId);
      setCurrentAgentId(agentId);
      logger.info(`[Home] agents loaded, using agentId=${agentId}`);

      if (!hasRestoredRef.current) {
        hasRestoredRef.current = true;
        const lastConv = getLastConversation();
        const targetSession =
          lastConv &&
          lastConv.agentId === agentId &&
          lastConv.sessionId !== NEW_CHAT_SESSION
            ? lastConv.sessionId
            : chatSessionIdFor(agentId);
        setActiveSessionId(targetSession);
        saveLastConversation(agentId, targetSession);
        logger.info(
          `[Home] restore session: agentId=${agentId} sessionId=${targetSession}`
        );
      }
    },
    [setActiveSessionId]
  );

  /**
   * 数据刷新触发器。
   * - 连接版本递增：连接建立或重连成功后刷新 agent 清单，覆盖冷启动隧道未就绪的场景
   * - 镜像版本递增：快照装载、变更回放与清单刷新后重读 agent 清单与会话列表
   * - 当前 agent 变化：切换后重读会话列表
   */
  useEffect(() => {
    if (reconnectVersion === 0) {
      return;
    }
    agentsSync.refresh();
  }, [reconnectVersion]);

  useEffect(() => {
    (async () => {
      try {
        logger.info(`[Home] mirror reload, mirrorVersion=${mirrorVersion}`);
        const cached = await cacheDb.listAgents();
        if (cached.length > 0) {
          noteAgentHashes(cached);
          setAgents(cached);
          settleCurrentAgent(cached);
        }
        await handleUpdateHistory();
      } catch (e) {
        logger.warn(`[Home] mirror reload failed: ${e}`);
      }
    })();
  }, [mirrorVersion, currentAgentId, settleCurrentAgent, handleUpdateHistory]);

  /** 返回焦点时刷新 agent 清单，让桌面端的改名改配等修改回到移动端即可见，首焦已由连接触发器覆盖 */
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      logger.info('[Home] focus reload agents');
      agentsSync.refresh();
    }, [])
  );

  /** agent 名称同步进会话仓库，占位气泡与历史消息转换使用 */
  useEffect(() => {
    useChatStore
      .getState()
      .setAgentProfile(
        agents.find((a) => a.id === currentAgentId)?.name ?? 'AI'
      );
  }, [agents, currentAgentId]);

  // ==================== agent 条交互 ====================
  /**
   * 头像条点击。点其他 agent 切当前 agent 并刷新内容列，
   * 点当前 agent 进配置页，进入聊天只走内容列入口。
   */
  const handleSelectAgent = (agentId: string) => {
    if (agentId === currentAgentId) {
      return;
    }
    logger.info(`[Home] agent switch → ${agentId}`);
    saveServerAgentId(agentId);
    saveLastConversation(agentId, chatSessionIdFor(agentId));
    setCurrentAgentId(agentId);
    useVoiceStore.getState().stopSpeaking();
    // 进入新 Agent 的常驻聊天会话身份，列表与卡片由 effect 重新拉取
    setActiveSessionId(chatSessionIdFor(agentId));
  };

  /** 打开当前 Agent 的常驻聊天会话，入口卡标题作快照传给 Chat 头部。
   *  身份经 useCallback 固化，配合列表头部的 memo 隔离无关重渲染。 */
  const openChatSession = useCallback(() => {
    if (!currentAgentId) {
      return;
    }
    logger.info(`[Home] open chat session: ${currentChatSessionId}`);
    setActiveSessionId(currentChatSessionId);
    navigation.navigate('Chat', { title: t('home.chat') });
  }, [currentAgentId, currentChatSessionId, setActiveSessionId, navigation, t]);

  // ==================== 会话列表交互 ====================
  /** 点会话行续聊，列表标题作快照传给 Chat 头部。
   *  身份经 useCallback 固化，会话行 memo 才能在无关渲染时跳过。 */
  const handleOpenSession = useCallback(
    (item: Chat) => {
      logger.info(`[Home] open session: ${item.id}`);
      setActiveSessionId(item.id);
      navigation.navigate('Chat', {
        title: sessionTitles[item.id] ?? item.title,
      });
    },
    [navigation, sessionTitles, setActiveSessionId]
  );

  /** 新建对话，进入 Chat 的空白新建态 */
  const handleNewChat = () => {
    trigger(HapticFeedbackTypes.impactMedium);
    logger.info('[Home] new chat');
    setActiveSessionId(NEW_CHAT_SESSION);
    navigation.navigate('Chat');
  };

  /**
   * 删除会话：先乐观更新 UI，再调服务器 API，失败时回滚。
   * 删的是当前会话则回到该 Agent 的常驻聊天，并同步清掉会话仓库分片。
   * 身份经 useCallback 固化，会话行 memo 才能在无关渲染时跳过。
   */
  const handleDelete = useCallback(
    (id: string) => {
      logger.info(`[Home] delete session: ${id}`);
      setChatHistory((prev) => prev.filter((chat) => chat.id !== id));
      useChatStore.getState().removeSession(id);
      if (id === activeSessionId) {
        setActiveSessionId(currentChatSessionId);
      }

      const address = getServerAddress();
      const agentId = getServerAgentId();
      if (address && agentId) {
        deleteSession(address, agentId, id).catch(() => {
          logger.warn('[Home] deleteSession failed, reloading');
          handleUpdateHistory();
        });
      }

      trigger(HapticFeedbackTypes.soft);
    },
    [
      activeSessionId,
      currentChatSessionId,
      setActiveSessionId,
      handleUpdateHistory,
    ]
  );

  /** 列表数据：标题映射后用 useMemo 固化身份，无关渲染不再重建数组 */
  const sessionListData = useMemo(
    () =>
      chatHistory.map((chat) => ({
        ...chat,
        title: sessionTitles[chat.id] ?? chat.title,
      })),
    [chatHistory, sessionTitles]
  );

  // ==================== 连接态 ====================
  /** 顶部连接钮图标按连接三态着色，连接绿、连接中与重连中蓝、断开红 */
  const serverIconColor =
    connectionStatus === 'connected'
      ? colors.success
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
      ? colors.primary
      : colors.error;

  /** 点当前头像进 AgentDetail 配置页 */
  const openAgentDetail = () => {
    if (!currentAgentId) {
      return;
    }
    logger.info(`[Home] open agent detail: ${currentAgentId}`);
    navigation.navigate('AgentDetail', { agentId: currentAgentId });
  };

  return (
    <View style={styles.root}>
      {/* 登记表为空时整页让位给首启扫码布局，连上台主机后自动回到会话主页 */}
      {deviceCount === 0 ? (
        <FirstLaunchView />
      ) : (
        <>
          {/* === 固定区，圆钮行避让状态栏，整体不随列表滚动 === */}
          <View style={[styles.fixed, { paddingTop: insets.top }]}>
            {/* 圆钮行，左上设置，右上连接与新建并排 */}
            <View style={styles.circleRow}>
              <TouchableOpacity
                style={styles.circleBtn}
                activeOpacity={0.7}
                accessibilityLabel={t('home.settings')}
                onPress={() => navigation.navigate('Settings')}
              >
                <Settings size={20} color={colors.textDarkGray} />
              </TouchableOpacity>
              <View style={styles.circleRowRight}>
                <TouchableOpacity
                  style={styles.circleBtn}
                  activeOpacity={0.7}
                  accessibilityLabel={t('device.manage')}
                  onPress={() => navigation.navigate('DeviceManage')}
                >
                  <MonitorSmartphone size={20} color={serverIconColor} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.circleBtn}
                  activeOpacity={0.7}
                  accessibilityLabel={t('home.newSession')}
                  onPress={handleNewChat}
                >
                  <Plus size={20} color={colors.textDarkGray} />
                </TouchableOpacity>
              </View>
            </View>
            {/* agent 横向条，原生横滑，点当前头像进配置页，点其他头像切换 */}
            <ScrollView
              style={styles.agentStrip}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.agentTrack}
            >
              {agents.map((agent) => {
                const isCurrent = currentAgentId === agent.id;
                const isRunning = runningAgentIds.includes(agent.id);
                return (
                  <TouchableOpacity
                    key={agent.id}
                    style={styles.agentItem}
                    activeOpacity={0.8}
                    onPress={() =>
                      isCurrent
                        ? openAgentDetail()
                        : handleSelectAgent(agent.id)
                    }
                  >
                    {/* 运行中圈位让给变长弧，选中实圈只在空闲时出现，选中信号由名字颜色继续承担 */}
                    <View
                      style={[
                        styles.avatarRing,
                        isCurrent && !isRunning && styles.avatarRingCurrent,
                      ]}
                    >
                      <AgentAvatar
                        agentId={agent.id}
                        serverAddress={serverAddress}
                        size={64}
                        fallbackIconSize={32}
                      />
                      {isRunning && <AgentRunningRing />}
                      {unreadAgentIds.includes(agent.id) && (
                        <View style={styles.avatarUnreadDot} />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.agentItemName,
                        isCurrent && styles.agentItemNameCurrent,
                      ]}
                      numberOfLines={1}
                    >
                      {agent.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {/* 状态槽，红蓝绿条由公共组件按连接态渲染，与 Chat 页同款 */}
            <ConnectionBanner />
            {/* 固定区下沿淡阴影压在滚动内容之上，透明底出影仅 iOS 生效 */}
            <View style={styles.fixedShadow} />
          </View>

          {/* === 滚动区，从聊天入口开始，底部避让 home indicator === */}
          <FlatList
            data={sessionListData}
            style={styles.flatList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: insets.bottom }}
            renderItem={({ item }) => (
              <SessionListItem
                item={item}
                onPress={handleOpenSession}
                onDelete={handleDelete}
              />
            )}
            ListHeaderComponent={
              <>
                {/* 分割线，聊天块首元素，随列表内容一起滚动 */}
                <View style={styles.divider} />
                <HomeListHeader
                  preview={chatEntryPreview}
                  running={chatRunning}
                  unread={chatUnread && !chatOnStage}
                  onOpenChat={openChatSession}
                />
              </>
            }
            ListEmptyComponent={
              <Text style={styles.emptySessions}>{t('home.startChat')}</Text>
            }
          />
        </>
      )}
    </View>
  );
};

/** 运行圈外径，avatarRing 的 padding 3 加边框 2 包住 64 头像 */
const RING_BOX = 74;
/** 圆环中线半径，正落在现有 avatarRing 边框的位置 */
const RING_RADIUS = 36;

/**
 * Agent 头像运行圈，全圈呼吸。
 * 整圈实线透明度一起一伏，1.4s 一个来回，
 * 只在 Agent 名下会话运行期间挂载，靠动与不动区分选中态。
 */
const AgentRunningRing = () => {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.15);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.15, { duration: 700, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const ringStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, ringStyle]}
      pointerEvents="none"
    >
      <Svg style={StyleSheet.absoluteFill}>
        <Circle
          cx={RING_BOX / 2}
          cy={RING_BOX / 2}
          r={RING_RADIUS}
          stroke={colors.primary}
          strokeWidth={2}
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
};

/** 会话主页样式工厂 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    /** 固定区，圆钮行到淡阴影整体不随列表滚动 */
    fixed: {
      backgroundColor: colors.background,
    },
    /** 圆钮行，左右两端对齐 */
    circleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 2,
    },
    circleRowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    /** 悬浮白圆钮，柔投影浮在页面之上 */
    circleBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      boxShadow: `0px 4px 10px ${colors.shadow}`,
    },
    /** agent 横向条 */
    agentStrip: {
      flexGrow: 0,
      marginTop: 6,
    },
    agentTrack: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 20,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    agentItem: {
      alignItems: 'center',
      gap: 6,
    },
    /** 头像外常驻包裹，非当前项边框透明，保证有环无环头像与名字对齐 */
    avatarRing: {
      padding: 3,
      borderRadius: 37,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    avatarRingCurrent: {
      borderColor: colors.primary,
    },
    /**
     * 头像角上未读点，名下任一会话未读即亮，绿色与 SignalSlot 的未读点同色。
     * 偏移随目视调参变动，骑线参考值为 10.84 减尺寸一半，数值越大点越向内。
     */
    avatarUnreadDot: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.success,
      borderWidth: 2,
      borderColor: colors.card,
    },
    agentItemName: {
      ...typography.content,
      maxWidth: 80,
      color: colors.textSecondary,
    },
    agentItemNameCurrent: {
      color: colors.primary,
      fontWeight: '600',
    },
    flatList: {
      flex: 1,
    },
    divider: {
      height: 1,
      backgroundColor: colors.borderLight,
      marginHorizontal: 16,
      marginVertical: 10,
    },
    /** 固定区下沿淡阴影，透明底出影仅 iOS 生效 */
    fixedShadow: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: 'transparent',
      shadowColor: colors.shadow,
      shadowOpacity: 1,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 4 },
    },
    /** 常驻聊天入口卡片 */
    chatCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginHorizontal: 10,
      borderRadius: 12,
    },
    /** 聊天入口图标，顶部补偿 3px 与两行文字的首行光学居中 */
    chatCardIcon: {
      marginTop: 3,
    },
    /** 聊天入口信号位，贴卡片右上角，与图标同做光学补偿 */
    chatCardSignal: {
      marginTop: 3,
    },
    chatCardText: {
      ...typography.titleDisplay,
      fontWeight: '500',
      color: colors.text,
    },
    chatTextContainer: {
      flex: 1,
      marginLeft: 12,
    },
    chatPreview: {
      ...typography.content,
      color: colors.textSecondary,
      marginTop: 2,
    },
    /** 工具与技能入口行 */
    navEntryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginHorizontal: 10,
      borderRadius: 12,
    },
    navEntryText: {
      flex: 1,
      ...typography.titleDisplay,
      color: colors.text,
    },
    /** 会话区标题行 */
    sessionsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      marginHorizontal: 10,
      paddingTop: 12,
      paddingBottom: 4,
    },
    sessionsHeaderText: {
      flex: 1,
      ...typography.titleDisplay,
      color: colors.text,
    },
    /** 零会话占位提示，左边距与会话标题同列对齐 */
    emptySessions: {
      paddingLeft: 54,
      paddingRight: 28,
      paddingVertical: 12,
      ...typography.body,
      color: colors.textSecondary,
    },
  });

export default HomeScreen;
