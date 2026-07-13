/**
 * @file CustomDrawerContent.tsx
 * @description 侧边栏（Drawer）内容组件，五段式垂直布局：
 *   Agent 卡片 → 常驻聊天入口 → 导航按钮(工具/技能) → 会话列表 → 底部(Server/Settings)。
 *   会话列表支持按日期分组、点击切换、长按删除。常驻聊天会话(chat-*)不显示在列表中。
 */
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  DrawerContentComponentProps,
  useDrawerStatus,
} from '@react-navigation/drawer';
import { Chat } from '../types/Chat.ts';
import { logger } from '../lib/logger';
import {
  type AgentInfo,
  chatSessionIdFor,
  deleteSession,
  fetchAgentDetail,
  fetchSessions,
  getAgentAvatarUrl,
  isChatSession,
} from '../api/server-api.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import Dialog from 'react-native-dialog';
import { useAppContext } from './AppProvider.tsx';
import { trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';
import { DrawerActions } from '@react-navigation/native';
import {
  MessageCircle,
  MessagesSquare,
  MonitorSmartphone,
  Plus,
  Sparkles,
  User,
  Wrench,
} from 'lucide-react-native';
import { useTheme, ColorScheme } from '../theme/index.ts';

/**
 * 自定义侧边栏内容组件
 *
 * React Navigation 框架通过 props 传入3个属性（类型定义见 DrawerContentComponentProps）：
 * - state: 当前的导航状态（有哪些页面、当前在第几个页面）
 * - navigation: 导航方法（navigate跳转、goBack返回、dispatch发送导航指令等）
 * - descriptors: 每个页面的配置信息（页面标题、样式选项等）
 */
const CustomDrawerContent: React.FC<DrawerContentComponentProps> = ({
  navigation,
}) => {
  const { colors, isDark } = useTheme();
  /** 按日期分组后的会话列表（含虚拟标题行），直接传给 FlatList 渲染 */
  const [groupChatHistory, setGroupChatHistory] = useState<Chat[]>([]);
  /** 是否显示删除确认弹窗 */
  const [showDialog, setShowDialog] = useState<boolean>(false);
  /** 待删除的会话 ID，长按时暂存 */
  const deleteIdRef = useRef<string>('');
  const drawerStatus = useDrawerStatus();
  /** 当前选中的会话 ID，用于高亮显示 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 点击计数器，每次跳转会话时递增，用作路由参数触发 useEffect */
  const tapIndexRef = useRef<number>(1);
  /** Drawer 顶部展示的当前 Agent 信息（点击可进入详情页） */
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [agentAvatarError, setAgentAvatarError] = useState(false);
  const { event, sendEvent } = useAppContext();

  /** 监听 AppContext 跨组件事件：刷新历史、更新选中项、标题变更、Agent 切换 */
  useEffect(() => {
    if (event?.event === 'updateHistory') {
      handleUpdateHistory();
    } else if (event?.event === 'updateHistorySelectedId') {
      setSelectedId(event.params?.id != null ? String(event.params.id) : null);
    } else if (event?.event === 'titleUpdated') {
      const { id, title } = event.params ?? {};
      if (id != null && title) {
        const idStr = String(id);
        setGroupChatHistory((prev) =>
          prev.map((chat) =>
            chat.id === idStr ? { ...chat, title: title as string } : chat
          )
        );
      }
    } else if (event?.event === 'agentChanged') {
      handleUpdateHistory();
      loadAgentInfo();
      setSelectedId(null);
    }
  }, [event]);

  /**
   * 监听 Drawer 开合状态：打开时拉取最新会话列表并触感反馈。
   */
  useEffect(() => {
    if (drawerStatus === 'open') {
      trigger(HapticFeedbackTypes.soft);
      trigger(HapticFeedbackTypes.selection);
      handleUpdateHistory();
      loadAgentInfo();
    } else {
      trigger(HapticFeedbackTypes.selection);
      trigger(HapticFeedbackTypes.soft);
    }
  }, [drawerStatus, navigation]);

  /**
   * 从服务器拉取会话列表并更新 UI。
   * 常驻聊天会话(chat-*)不显示在列表中，通过顶部聊天卡片入口访问。
   */
  const handleUpdateHistory = async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      return;
    }
    try {
      const sessions = await fetchSessions(address, agentId);
      const regularSessions = sessions.filter((s) => !isChatSession(s.id));
      const chatList: Chat[] = regularSessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
      }));
      setGroupChatHistory(chatList);
    } catch (e) {
      logger.error(`[Drawer] fetchSessions failed: ${e}`);
    }
  };

  /** 从服务器拉取当前 Agent 信息，用于 Drawer 顶部卡片展示 */
  const loadAgentInfo = async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      return;
    }
    try {
      const detail = await fetchAgentDetail(address, agentId);
      setAgentInfo(detail);
      setAgentAvatarError(false);
    } catch (e) {
      logger.error(`[Drawer] fetchAgentDetail failed: ${e}`);
    }
  };

  /**
   * 删除会话：先乐观更新 UI，再调服务器 API，失败时回滚。
   */
  const handleDelete = () => {
    const targetId = deleteIdRef.current;

    setGroupChatHistory((prev) => prev.filter((chat) => chat.id !== targetId));
    sendEvent('deleteChat', { id: targetId });

    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (address && agentId) {
      deleteSession(address, agentId, targetId).catch(() => {
        logger.warn('[Drawer] deleteSession failed, reloading');
        handleUpdateHistory();
      });
    }

    trigger(HapticFeedbackTypes.soft);
    deleteIdRef.current = '';
  };

  /** 新建对话：通知 ChatScreen 清空并创建新会话，然后关闭侧边栏 */
  const handleNewChat = () => {
    trigger(HapticFeedbackTypes.impactMedium);
    logger.info('[Drawer] new chat');
    sendEvent('newChat');
    navigation.dispatch(DrawerActions.closeDrawer());
  };

  /** 导航到常驻聊天会话并关闭侧边栏 */
  const navigateToChatSession = () => {
    const agentId = getServerAgentId();
    if (!agentId) {
      return;
    }
    const chatSessionId = chatSessionIdFor(agentId);
    logger.info(`[Drawer] open chat session: ${chatSessionId}`);
    navigation.navigate('Bedrock', {
      sessionId: chatSessionId,
      tapIndex: tapIndexRef.current,
    });
    tapIndexRef.current += 1;
    navigation.dispatch(DrawerActions.closeDrawer());
  };

  /** 导航到 Stack 页面，侧边栏保持开启状态 */
  const navigateToStackScreen = (
    route: 'Tools' | 'Skills' | 'Server' | 'Settings'
  ) => {
    navigation.navigate(route);
  };

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* === 1. Agent 信息卡片，点击进入详情页 === */}
      {agentInfo && (
        <TouchableOpacity
          style={styles.agentCard}
          activeOpacity={0.7}
          onPress={() => {
            const currentAgentId = getServerAgentId();
            if (!currentAgentId) {
              return;
            }
            navigation.navigate('AgentDetail', { agentId: currentAgentId });
          }}
        >
          {(() => {
            const serverAddr = getServerAddress();
            const canLoad = serverAddr.length > 0 && agentInfo.id.length > 0;
            return canLoad && !agentAvatarError ? (
              <Image
                source={{ uri: getAgentAvatarUrl(agentInfo.id, serverAddr) }}
                style={styles.agentAvatar}
                onError={() => setAgentAvatarError(true)}
              />
            ) : (
              <View style={styles.agentAvatarFallback}>
                <User size={22} color="#9CA3AF" />
              </View>
            );
          })()}
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
          <Text style={styles.agentArrow}>›</Text>
        </TouchableOpacity>
      )}

      <View style={styles.divider} />

      {/* === 2. 常驻聊天入口 === */}
      <TouchableOpacity
        style={styles.chatCard}
        activeOpacity={0.7}
        onPress={navigateToChatSession}
      >
        <View style={styles.chatIconWrapper}>
          <MessageCircle size={20} color={colors.text} />
        </View>
        <Text style={styles.chatCardText}>Chat</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* === 3. 导航按钮区：工具 / 技能 === */}
      <View style={styles.navSection}>
        <TouchableOpacity
          style={styles.navButton}
          activeOpacity={0.7}
          onPress={() => navigateToStackScreen('Tools')}
        >
          <Wrench size={20} color={colors.textSecondary} />
          <Text style={styles.navButtonText}>Tools</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navButton}
          activeOpacity={0.7}
          onPress={() => navigateToStackScreen('Skills')}
        >
          <Sparkles size={20} color={colors.textSecondary} />
          <Text style={styles.navButtonText}>Skills</Text>
        </TouchableOpacity>
      </View>

      {/* === 4. 会话列表（可滚动） === */}
      <View style={styles.sessionsHeader}>
        <View style={styles.sessionsHeaderLeft}>
          <MessagesSquare size={20} color={colors.textSecondary} />
          <Text style={styles.sessionsHeaderText}>Sessions</Text>
        </View>
        <TouchableOpacity
          onPress={handleNewChat}
          style={styles.newChatButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Plus size={20} color={colors.text} />
        </TouchableOpacity>
      </View>
      <FlatList
        data={groupChatHistory}
        style={styles.flatList}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isSelected = selectedId === item.id;
          return (
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {
                setSelectedId(item.id);
                setTimeout(() => {
                  navigation.navigate('Bedrock', {
                    sessionId: item.id,
                    tapIndex: tapIndexRef.current,
                  });
                  tapIndexRef.current += 1;
                }, 0);
              }}
              onLongPress={(gestureEvent) => {
                trigger(HapticFeedbackTypes.notificationWarning);
                gestureEvent.preventDefault();
                setShowDialog(true);
                deleteIdRef.current = item.id;
              }}
              style={[styles.touch, isSelected && styles.touchSelected]}
            >
              <Text numberOfLines={1} style={styles.title}>
                {item.title}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* === 5. 底部入口：Server / Settings === */}
      <View style={styles.divider} />
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.footerButton}
          activeOpacity={0.7}
          onPress={() => navigateToStackScreen('Server')}
        >
          <MonitorSmartphone size={20} color={colors.textSecondary} />
          <Text style={styles.footerText}>Server</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.footerButton}
          activeOpacity={0.7}
          onPress={() => navigateToStackScreen('Settings')}
        >
          <Image
            source={
              isDark
                ? require('../assets/settings_dark.png')
                : require('../assets/settings.png')
            }
            style={styles.settingsImg}
          />
          <Text style={styles.footerText}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* 删除会话确认弹窗 */}
      <Dialog.Container visible={showDialog}>
        <Dialog.Title>Delete Message</Dialog.Title>
        <Dialog.Description>You cannot undo this action.</Dialog.Description>
        <Dialog.Button
          label="Cancel"
          onPress={() => {
            setShowDialog(false);
          }}
        />
        <Dialog.Button
          label="Delete"
          onPress={() => {
            handleDelete();
            setShowDialog(false);
          }}
        />
      </Dialog.Container>
    </SafeAreaView>
  );
};

/** 侧边栏样式工厂，根据当前主题色生成各组件样式 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.drawerBackground,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: 12,
    },
    /** Agent 信息卡片 */
    agentCard: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginHorizontal: 12,
      marginTop: 8,
      marginBottom: 4,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    agentAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    agentAvatarFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#E5E7EB',
    },
    agentInfo: {
      flex: 1,
      marginLeft: 12,
    },
    agentName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    agentDesc: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 2,
    },
    agentArrow: {
      fontSize: 20,
      color: colors.textTertiary,
      marginLeft: 4,
    },
    /** 常驻聊天入口卡片 */
    chatCard: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginHorizontal: 12,
      marginVertical: 8,
    },
    chatIconWrapper: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatCardText: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
      marginLeft: 12,
    },
    /** 导航按钮区 */
    navSection: {
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    navButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
    },
    navButtonText: {
      fontSize: 15,
      color: colors.text,
      marginLeft: 12,
    },
    /** Sessions 分区标题，左侧图标+文字，右侧新建对话按钮 */
    sessionsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 4,
    },
    sessionsHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    newChatButton: {
      padding: 4,
    },
    sessionsHeaderText: {
      fontSize: 15,
      color: colors.text,
      marginLeft: 12,
    },
    /** 会话列表 */
    flatList: {
      flex: 1,
    },
    touch: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginHorizontal: 12,
      marginVertical: 2,
      borderRadius: 8,
    },
    touchSelected: {
      backgroundColor: colors.selectedBackground,
    },
    title: {
      fontSize: 15,
      color: colors.text,
    },
    /** 底部 Server / Settings */
    footer: {
      paddingVertical: 4,
    },
    footerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    footerText: {
      fontSize: 15,
      color: colors.textSecondary,
      marginLeft: 12,
    },
    settingsImg: {
      width: 20,
      height: 20,
      borderRadius: 10,
    },
  });

export default CustomDrawerContent;
