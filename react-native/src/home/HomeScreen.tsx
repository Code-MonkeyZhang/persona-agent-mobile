/**
 * @file home/HomeScreen.tsx
 * @description 会话主页，应用首屏。
 *   左缘 76 像素 agent 竖栏加内容列的两列布局，长相基准是 demo 抽屉设计。
 *   竖栏底色铺满安全区，头像与内容只避让状态栏与 home indicator。
 *   agent 拉取与当前 agent 确定与启动会话恢复在连接建立后完成。
 *   Chat 是压栈页，点聊天入口或会话行进入，返回即回到本页。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { ColorScheme, useTheme } from '../theme/index.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import {
  type AgentInfo,
  chatSessionIdFor,
  deleteSession,
  fetchAgentDetail,
  fetchAgents,
  fetchSessions,
  isChatSession,
} from '../api/server-api.ts';
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
import { useVoiceStore } from '../stores/voiceStore';
import { useAppPanelStore } from '../stores/appPanelStore';
import { useChatStore } from '../stores/chatStore';
import { Chat } from '../types/Chat.ts';
import AgentAvatar from '../chat/component/AgentAvatar.tsx';
import SessionListItem from '../history/SessionListItem.tsx';
import ConnectionBanner from './ConnectionBanner.tsx';

type HomeScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Home'
>;

/** 左缘 agent 竖栏宽度 */
const RAIL_WIDTH = 76;

const HomeScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  /** 安全区尺寸，竖栏底色铺满安全区，内容与头像只做避让 */
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  // ==================== 本地状态 ====================
  /** 竖栏的 agent 列表，挂载时拉取一次 */
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState(
    getServerAgentId() || ''
  );
  /** 内容列头卡的当前 Agent 详情 */
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  /** 会话列表，常驻聊天会话不进列表 */
  const [chatHistory, setChatHistory] = useState<Chat[]>([]);
  /** 服务端返回的常驻聊天会话预览，拉取列表时更新 */
  const [chatLastMessage, setChatLastMessage] = useState<string | undefined>(
    undefined
  );
  /** 当前处于展开状态的会话 id，用于左滑删除的同时只开一个协调 */
  const [openId, setOpenId] = useState<string | null>(null);
  /** 启动恢复只执行一次的守卫 */
  const hasRestoredRef = useRef(false);

  // ==================== store ====================
  const sessionPreviews = useSessionStore((s) => s.sessionPreviews);
  const sessionTitles = useSessionStore((s) => s.sessionTitles);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const homeRefreshVersion = useSessionStore((s) => s.homeRefreshVersion);
  const serverAddress = useConnectionStore((s) => s.serverAddress);
  const connectionStatus = useConnectionStore((s) => s.status);
  const reconnectVersion = useConnectionStore((s) => s.reconnectVersion);

  /** 当前 Agent 的常驻聊天会话 ID，复用于高亮与预览查找 */
  const currentChatSessionId = chatSessionIdFor(currentAgentId);
  /** 聊天入口的末句预览，本地实时补丁优先，服务端 lastMessage 兜底 */
  const chatEntryPreview =
    sessionPreviews[currentChatSessionId] ||
    chatLastMessage ||
    t('home.startChat');

  // ==================== 列表与卡片拉取 ====================
  /** 从服务器拉取会话列表，常驻聊天会话只取其预览不进列表 */
  const handleUpdateHistory = useCallback(async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      return;
    }
    try {
      const sessions = await fetchSessions(address, agentId);
      // 迟到的响应已不属于当前 agent 时丢弃，避免覆盖切换后的列表
      if (getServerAgentId() !== agentId) {
        return;
      }
      const chatList: Chat[] = sessions
        .filter((s) => !isChatSession(s.id))
        .map((s) => ({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
        }));
      setChatHistory(chatList);
      setChatLastMessage(
        sessions.find((s) => isChatSession(s.id))?.lastMessage
      );
    } catch (e) {
      logger.error(`[Home] fetchSessions failed: ${e}`);
    }
  }, []);

  /** 从服务器拉取当前 Agent 详情，用于内容列头卡展示 */
  const loadAgentInfo = useCallback(async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      return;
    }
    try {
      const detail = await fetchAgentDetail(address, agentId);
      if (getServerAgentId() !== agentId) {
        return;
      }
      setAgentInfo(detail);
    } catch (e) {
      logger.error(`[Home] fetchAgentDetail failed: ${e}`);
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

  /**
   * 拉取 agent 列表并确定当前 agent，首次拉取成功时执行启动恢复，
   * 恢复上次会话或兜底到常驻聊天。
   */
  const loadAgents = useCallback(async () => {
    const address = getServerAddress();
    if (!address) {
      return;
    }
    try {
      const fetchedAgents = await fetchAgents(address);
      if (fetchedAgents.length === 0) {
        return;
      }
      setAgents(fetchedAgents);

      let agentId = getServerAgentId();
      if (!agentId || !fetchedAgents.some((a) => a.id === agentId)) {
        agentId = fetchedAgents[0].id;
      }
      saveServerAgentId(agentId);
      setCurrentAgentId(agentId);
      logger.info(`[Home] agents loaded, using agentId=${agentId}`);

      // 启动恢复：上次 Agent 还在且会话非空则恢复上次会话，否则兜底到常驻聊天
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
    } catch (e) {
      logger.error(
        `[Home] loadAgents failed: ${e instanceof Error ? e.message : e}`
      );
    }
  }, [setActiveSessionId]);

  /**
   * 数据拉取触发器。
   * - 连接版本递增：连接建立或重连成功后重拉全部，覆盖冷启动隧道未就绪的场景
   * - 刷新触发器递增：回合结束后重拉列表与卡片
   * - 当前 agent 变化：切换后重拉列表与卡片
   * 首次连接建立前不拉取，避免隧道未就绪时的无效请求
   */
  useEffect(() => {
    if (reconnectVersion === 0) {
      return;
    }
    logger.info(
      `[Home] data reload triggered, connVersion=${reconnectVersion}`
    );
    loadAgents();
    handleUpdateHistory();
    loadAgentInfo();
  }, [
    reconnectVersion,
    homeRefreshVersion,
    currentAgentId,
    loadAgents,
    handleUpdateHistory,
    loadAgentInfo,
  ]);

  /** 返回焦点时重拉 agent 列表，让桌面端的改名改配等修改回到移动端即可见，首焦已由连接触发器覆盖 */
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      logger.info('[Home] focus reload agents');
      loadAgents();
    }, [loadAgents])
  );

  /** agent 名称同步进会话仓库，占位气泡与历史消息转换使用 */
  useEffect(() => {
    useChatStore
      .getState()
      .setAgentProfile(
        agents.find((a) => a.id === currentAgentId)?.name ?? 'AI'
      );
  }, [agents, currentAgentId]);

  // ==================== 竖栏交互 ====================
  /**
   * 竖栏点击。点其他 agent 切当前 agent 并刷新内容列，
   * 点当前 agent 无动作，进入聊天只走内容列入口。
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
    // Agent 切换后不再恢复上一个 Agent 打开过的 App
    useAppPanelStore.getState().setCurrentAppId(null);
    // 进入新 Agent 的常驻聊天会话身份，列表与卡片由 effect 重新拉取
    setActiveSessionId(chatSessionIdFor(agentId));
  };

  /** 打开当前 Agent 的常驻聊天会话，入口卡标题作快照传给 Chat 头部 */
  const openChatSession = () => {
    if (!currentAgentId) {
      return;
    }
    logger.info(`[Home] open chat session: ${currentChatSessionId}`);
    setActiveSessionId(currentChatSessionId);
    navigation.navigate('Chat', { title: t('home.chat') });
  };

  // ==================== 会话列表交互 ====================
  /** 点会话行续聊，列表标题作快照传给 Chat 头部 */
  const handleOpenSession = (item: Chat) => {
    logger.info(`[Home] open session: ${item.id}`);
    setActiveSessionId(item.id);
    navigation.navigate('Chat', {
      title: sessionTitles[item.id] ?? item.title,
    });
  };

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
   */
  const handleDelete = (id: string) => {
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
  };

  // ==================== 连接态条 ====================
  /** 红条点击。地址无效或无地址进 Server 改地址，其余以当前地址立即重连重置退避 */
  const handleBannerPress = () => {
    const conn = useConnectionStore.getState();
    if (conn.status === 'address_invalid' || !conn.serverAddress) {
      logger.info('[Home] banner tap, go Server');
      navigation.navigate('Server');
      return;
    }
    logger.info('[Home] banner tap, reconnect now');
    conn.connect(conn.serverAddress);
  };

  /** 竖栏底部服务器图标按连接三态着色，连接绿、连接中与重连中蓝、断开红 */
  const serverIconColor =
    connectionStatus === 'connected'
      ? colors.success
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
      ? colors.primary
      : colors.error;

  /** 内容列头卡行，进 AgentDetail */
  const renderAgentCard = () => {
    if (!agentInfo) {
      return (
        <View style={styles.agentCard}>
          <AgentAvatar
            agentId=""
            serverAddress=""
            size={44}
            fallbackIconSize={22}
          />
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={styles.agentCard}
        activeOpacity={0.7}
        onPress={() => {
          if (!currentAgentId) {
            return;
          }
          navigation.navigate('AgentDetail', { agentId: currentAgentId });
        }}
      >
        <AgentAvatar
          agentId={agentInfo.id}
          serverAddress={serverAddress}
          size={44}
          fallbackIconSize={22}
        />
        <View style={styles.agentInfo}>
          <Text style={styles.agentName} numberOfLines={1}>
            {agentInfo.name}
          </Text>
          {agentInfo.description ? (
            <Text style={styles.agentDesc} numberOfLines={1}>
              {agentInfo.description}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      {/* === 左缘 agent 竖栏，底色铺满安全区 === */}
      <View style={styles.rail}>
        <ScrollView
          style={styles.railList}
          contentContainerStyle={{ paddingTop: insets.top + 2 }}
          showsVerticalScrollIndicator={false}
        >
          {agents.map((agent) => {
            const isCurrent = currentAgentId === agent.id;
            return (
              <TouchableOpacity
                key={agent.id}
                style={styles.railItem}
                activeOpacity={0.8}
                onPress={() => handleSelectAgent(agent.id)}
              >
                {isCurrent && <View style={styles.railPill} />}
                {isCurrent && <View style={styles.railBar} />}
                <AgentAvatar
                  agentId={agent.id}
                  serverAddress={serverAddress}
                  size={44}
                  fallbackIconSize={22}
                />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* 竖栏底部 Server 与 Settings，Server 图标按连接态着色，避让 home indicator */}
        <View style={[styles.railFooter, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity
            style={styles.railFooterButton}
            activeOpacity={0.7}
            accessibilityLabel={t('home.server')}
            onPress={() => navigation.navigate('Server')}
          >
            <MonitorSmartphone size={26} color={serverIconColor} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.railFooterButton}
            activeOpacity={0.7}
            accessibilityLabel={t('home.settings')}
            onPress={() => navigation.navigate('Settings')}
          >
            <Settings size={26} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* === 内容列，连接态条置顶，其余整体滚动，顶部避让状态栏 === */}
      <View style={[styles.content, { paddingTop: insets.top }]}>
        <ConnectionBanner onPress={handleBannerPress} />
        <FlatList
          data={chatHistory.map((chat) => ({
            ...chat,
            title: sessionTitles[chat.id] ?? chat.title,
          }))}
          style={styles.flatList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom }}
          renderItem={({ item }) => (
            <SessionListItem
              item={item}
              isSelected={activeSessionId === item.id}
              openId={openId}
              onPress={() => handleOpenSession(item)}
              onOpen={setOpenId}
              onDelete={handleDelete}
            />
          )}
          ListHeaderComponent={
            <View>
              {renderAgentCard()}
              <View style={styles.divider} />
              {/* 常驻聊天入口，选中态左侧蓝条 */}
              <TouchableOpacity
                style={[
                  styles.chatCard,
                  activeSessionId === currentChatSessionId &&
                    styles.chatCardSelected,
                ]}
                activeOpacity={0.7}
                onPress={openChatSession}
              >
                <MessageCircle
                  size={20}
                  color={
                    activeSessionId === currentChatSessionId
                      ? colors.primary
                      : colors.textSecondary
                  }
                />
                <View style={styles.chatTextContainer}>
                  <Text
                    style={[
                      styles.chatCardText,
                      activeSessionId === currentChatSessionId &&
                        styles.chatCardTextSelected,
                    ]}
                  >
                    {t('home.chat')}
                  </Text>
                  <Text style={styles.chatPreview} numberOfLines={1}>
                    {chatEntryPreview}
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={styles.divider} />
              {/* 工具与技能入口行，点入 AgentNav 对应视图，与会话行同为 18px 文字与 20px 图标档 */}
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
              <View style={styles.divider} />
              {/* 会话区标题行，行尾新建加号 */}
              <View style={styles.sessionsHeader}>
                <MessagesSquare size={20} color={colors.textSecondary} />
                <Text style={styles.sessionsHeaderText}>
                  {t('home.sessions')}
                </Text>
                <TouchableOpacity
                  onPress={handleNewChat}
                  style={styles.newChatButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Plus size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.emptySessions}>{t('home.startChat')}</Text>
          }
        />
      </View>
    </View>
  );
};

/** 会话主页样式工厂 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: colors.background,
    },
    /** 左缘竖栏 */
    rail: {
      width: RAIL_WIDTH,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      backgroundColor: colors.surfaceSecondary,
    },
    railList: {
      flex: 1,
    },
    railItem: {
      position: 'relative',
      width: '100%',
      paddingVertical: 11,
      alignItems: 'center',
    },
    /** 选中项的白底胶囊，右缘留 4 像素缺口 */
    railPill: {
      position: 'absolute',
      left: 0,
      top: 6,
      bottom: 6,
      right: 4,
      borderTopRightRadius: 16,
      borderBottomRightRadius: 16,
      backgroundColor: colors.card,
      shadowColor: colors.shadow,
      shadowOpacity: 1,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    /** 选中项左侧的蓝色指示条 */
    railBar: {
      position: 'absolute',
      left: 0,
      top: 10,
      bottom: 10,
      width: 4,
      borderTopRightRadius: 2,
      borderBottomRightRadius: 2,
      backgroundColor: colors.primary,
    },
    railFooter: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: 10,
      paddingTop: 10,
      alignItems: 'center',
      gap: 6,
    },
    railFooterButton: {
      paddingVertical: 10,
    },
    /** 内容列 */
    content: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flatList: {
      flex: 1,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: 16,
      marginVertical: 6,
    },
    /** Agent 信息卡片 */
    agentCard: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 6,
      marginTop: 4,
    },
    agentInfo: {
      flex: 1,
      marginLeft: 12,
    },
    agentName: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    agentDesc: {
      fontSize: 13,
      color: colors.textTertiary,
      marginTop: 3,
    },
    /** 常驻聊天入口卡片 */
    chatCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginHorizontal: 10,
      borderRadius: 12,
      borderLeftWidth: 3.5,
      borderLeftColor: 'transparent',
    },
    chatCardSelected: {
      backgroundColor: colors.primarySelectedBackground,
      borderLeftColor: colors.primary,
    },
    chatCardText: {
      fontSize: 18,
      fontWeight: '500',
      color: colors.text,
    },
    chatCardTextSelected: {
      color: colors.primary,
    },
    chatTextContainer: {
      flex: 1,
      marginLeft: 10,
    },
    chatPreview: {
      fontSize: 13,
      color: colors.textTertiary,
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
      fontSize: 18,
      color: colors.text,
    },
    /** 会话区标题行 */
    sessionsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 4,
    },
    sessionsHeaderText: {
      flex: 1,
      fontSize: 18,
      color: colors.text,
    },
    newChatButton: {
      padding: 4,
      marginRight: 4,
    },
    emptySessions: {
      paddingHorizontal: 28,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.textTertiary,
    },
  });

export default HomeScreen;
