/**
 * @file CustomDrawerContent.tsx
 * @description 侧边栏（Drawer）内容组件，四段式垂直布局：
 *   Agent 卡片 → 常驻聊天入口 → 会话列表 → 底部(Server/Settings)。
 *   会话列表支持点击切换、长按删除，每项显示最新消息预览。常驻聊天会话(chat-*)不显示在列表中。
 */
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
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
import { useTranslation } from 'react-i18next';
import { Chat } from '../types/Chat.ts';
import { logger } from '../lib/logger';
import {
  type AgentInfo,
  chatSessionIdFor,
  deleteSession,
  fetchAgentDetail,
  fetchSessions,
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
  Settings,
} from 'lucide-react-native';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { useSessionStore } from '../stores/sessionStore';
import AgentAvatar from '../chat/component/AgentAvatar.tsx';

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
  const { colors } = useTheme();
  const { t } = useTranslation();
  const sessionPreviews = useSessionStore((s) => s.sessionPreviews);
  /** 会话列表，直接传给 FlatList 渲染 */
  const [chatHistory, setChatHistory] = useState<Chat[]>([]);
  /** 是否显示删除确认弹窗 */
  const [showDialog, setShowDialog] = useState<boolean>(false);
  /** 待删除的会话 ID，长按时暂存 */
  const deleteIdRef = useRef<string>('');
  const drawerStatus = useDrawerStatus();
  /** 当前选中的会话 ID，用于高亮显示 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Stack 中当前激活的路由名，用于高亮对应的侧边栏入口 */
  const [activeRoute, setActiveRoute] = useState<string | undefined>();
  /** 点击计数器，每次跳转会话时递增，用作路由参数触发 useEffect */
  const tapIndexRef = useRef<number>(1);
  /** Drawer 顶部展示的当前 Agent 信息（点击可进入详情页） */
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
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
        setChatHistory((prev) =>
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
   * 监听父级 Stack 导航器的路由变化，实时更新 activeRoute。
   * 用于高亮侧边栏中 Server / Settings 等入口。
   */
  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) {
      return;
    }
    const updateActiveRoute = () => {
      const parentState = parent.getState();
      setActiveRoute(parentState.routes[parentState.index]?.name);
    };
    updateActiveRoute();
    // navigation.getParent() 运行时包含 addListener，但 TS 类型 NavigationHelpers 未声明
    return (
      parent as unknown as {
        addListener: (event: string, callback: () => void) => () => void;
      }
    ).addListener('state', updateActiveRoute);
  }, [navigation]);

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
      setChatHistory(chatList);
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
    } catch (e) {
      logger.error(`[Drawer] fetchAgentDetail failed: ${e}`);
    }
  };

  /**
   * 删除会话：先乐观更新 UI，再调服务器 API，失败时回滚。
   */
  const handleDelete = () => {
    const targetId = deleteIdRef.current;

    setChatHistory((prev) => prev.filter((chat) => chat.id !== targetId));
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
  const navigateToStackScreen = (route: 'Server' | 'Settings') => {
    navigation.navigate(route);
  };

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* === 1. Agent 信息卡片，点击进入详情页；未连接时显示占位符保持布局 === */}
      {agentInfo ? (
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
            return (
              <AgentAvatar
                agentId={agentInfo.id}
                serverAddress={serverAddr}
                size={50}
                fallbackIconSize={26}
              />
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
      ) : (
        <View style={styles.agentCard}>
          <AgentAvatar
            agentId=""
            serverAddress=""
            size={50}
            fallbackIconSize={26}
          />
        </View>
      )}

      <View style={styles.divider} />

      {/* === 2. 常驻聊天入口 === */}
      <TouchableOpacity
        style={[
          styles.chatCard,
          activeRoute === 'Drawer' && !selectedId && styles.chatCardSelected,
        ]}
        activeOpacity={0.7}
        onPress={navigateToChatSession}
      >
        <MessageCircle
          size={24}
          color={
            activeRoute === 'Drawer' && !selectedId
              ? colors.primary
              : colors.textSecondary
          }
        />
        <View style={styles.chatTextContainer}>
          <Text
            style={[
              styles.chatCardText,
              activeRoute === 'Drawer' &&
                !selectedId &&
                styles.chatCardTextSelected,
            ]}
          >
            {t('drawer.chat')}
          </Text>
          <Text style={styles.chatPreview} numberOfLines={1}>
            {sessionPreviews[chatSessionIdFor(getServerAgentId())] ||
              t('drawer.startChat')}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* === 3. 会话列表（可滚动） === */}
      <View style={styles.sessionsHeader}>
        <View style={styles.sessionsHeaderLeft}>
          <MessagesSquare size={24} color={colors.textSecondary} />
          <Text style={styles.sessionsHeaderText}>{t('drawer.sessions')}</Text>
        </View>
        <TouchableOpacity
          onPress={handleNewChat}
          style={styles.newChatButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Plus size={24} color={colors.text} />
        </TouchableOpacity>
      </View>
      <FlatList
        data={chatHistory}
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
              <Text
                numberOfLines={1}
                style={[styles.title, isSelected && styles.titleSelected]}
              >
                {item.title}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* === 4. 底部入口：Server / Settings === */}
      <View style={styles.divider} />
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.footerButton}
          activeOpacity={0.7}
          onPress={() => navigateToStackScreen('Server')}
        >
          <MonitorSmartphone size={24} color={colors.textSecondary} />
          <Text style={styles.footerText}>{t('drawer.server')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.footerButton}
          activeOpacity={0.7}
          onPress={() => navigateToStackScreen('Settings')}
        >
          <Settings size={24} color={colors.textSecondary} />
          <Text style={styles.footerText}>{t('drawer.settings')}</Text>
        </TouchableOpacity>
      </View>

      {/* 删除会话确认弹窗 */}
      <Dialog.Container visible={showDialog}>
        <Dialog.Title>{t('drawer.deleteTitle')}</Dialog.Title>
        <Dialog.Description>{t('drawer.deleteDesc')}</Dialog.Description>
        <Dialog.Button
          label={t('drawer.cancel')}
          onPress={() => {
            setShowDialog(false);
          }}
        />
        <Dialog.Button
          label={t('drawer.delete')}
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
    agentInfo: {
      flex: 1,
      marginLeft: 12,
    },
    agentName: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    agentDesc: {
      fontSize: 15,
      color: colors.textTertiary,
      marginTop: 2,
    },
    agentArrow: {
      fontSize: 24,
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
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
    },
    chatCardSelected: {
      backgroundColor: colors.primarySelectedBackground,
      borderLeftColor: colors.primary,
    },
    chatCardText: {
      fontSize: 18,
      color: colors.textSecondary,
    },
    chatCardTextSelected: {
      color: colors.primary,
    },
    chatTextContainer: {
      flex: 1,
      marginLeft: 12,
    },
    chatPreview: {
      fontSize: 15,
      color: colors.textSecondary,
      marginTop: 2,
    },
    /** Sessions 分区标题，左侧图标+文字，右侧新建对话按钮 */
    sessionsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 31,
      paddingRight: 16,
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
      fontSize: 18,
      color: colors.text,
      marginLeft: 12,
    },
    /** 会话列表 */
    flatList: {
      flex: 1,
    },
    touch: {
      paddingLeft: 28,
      paddingRight: 16,
      paddingVertical: 12,
      marginHorizontal: 12,
      marginVertical: 2,
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
    },
    touchSelected: {
      backgroundColor: colors.primarySelectedBackground,
      borderLeftColor: colors.primary,
    },
    title: {
      fontSize: 18,
      color: colors.text,
    },
    titleSelected: {
      color: colors.primary,
    },
    /** 底部 Server / Settings */
    footer: {
      paddingVertical: 4,
    },
    footerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginHorizontal: 12,
      marginVertical: 2,
    },
    footerText: {
      fontSize: 18,
      color: colors.textSecondary,
      marginLeft: 12,
    },
  });

export default CustomDrawerContent;
