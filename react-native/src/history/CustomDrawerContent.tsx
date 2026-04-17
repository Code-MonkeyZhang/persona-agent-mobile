/**
 * @file CustomDrawerContent.tsx
 * @description 侧边栏（Drawer）内容组件，显示按日期分组的会话历史列表，
 *              支持点击切换会话、长按删除会话、底部跳转设置页。
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
import { deleteSession, fetchSessions } from '../api/nano-agent-api.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import Dialog from 'react-native-dialog';
import { useAppContext } from './AppProvider.tsx';
import { trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src';
import { groupMessagesByDate } from './HistoryGroupUtil.ts';
import { isMac } from '../App.tsx';
import { DrawerActions } from '@react-navigation/native';
import { useTheme, ColorScheme } from '../theme';

/**
 * 自定义侧边栏内容组件
 *
 * React Navigation 框架通过 props 传入3个属性（类型定义见 DrawerContentComponentProps）：
 * - state: 当前的导航状态（有哪些页面、当前在第几个页面）
 * - navigation: 导航方法（navigate跳转、goBack返回、dispatch发送导航指令等）
 * - descriptors: 每个页面的配置信息（页面标题、样式选项等）
 */
const CustomDrawerContent: React.FC<DrawerContentComponentProps> = ({
  // 从 props 中解构出 navigation，用于页面跳转（如 navigation.navigate('Settings')）
  navigation,
}) => {
  const { colors, isDark } = useTheme();
  /** 按日期分组后的会话列表（含虚拟标题行），直接传给 FlatList 渲染 */
  const [groupChatHistory, setGroupChatHistory] = useState<Chat[]>([]);
  /** groupChatHistory 的 ref 副本，供异步回调中读取 */
  const groupChatHistoryRef = useRef(groupChatHistory);
  /** 未分组的原始会话列表缓存 */
  const chatHistoryRef = useRef<Chat[]>([]);
  /** 是否显示删除确认弹窗 */
  const [showDialog, setShowDialog] = useState<boolean>(false);
  /** 待删除的会话 ID，长按时暂存 */
  const deleteIdRef = useRef<string>('');
  const drawerStatus = useDrawerStatus();
  /** 当前选中的会话 ID，用于高亮显示 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 点击计数器，每次跳转会话时递增，用作路由参数触发 useEffect */
  const tapIndexRef = useRef<number>(1);
  /** 是否首次渲染（Mac 端首次加载时直接拉取数据，不做 Drawer 动画） */
  const isFirstRenderRef = useRef<boolean>(true);
  /** Mac 端控制 Drawer 切换为 slide 模式的标记 */
  const isSlideDrawerEnabledRef = useRef<boolean>(false);
  const { event, sendEvent } = useAppContext();
  const { drawerType, setDrawerType } = useAppContext();

  const drawerTypeRef = useRef(drawerType);
  const setDrawerTypeRef = useRef(setDrawerType);

  /** 同步 drawerType 到 ref */
  useEffect(() => {
    drawerTypeRef.current = drawerType;
  }, [drawerType]);

  /** 同步 groupChatHistory 到 ref */
  useEffect(() => {
    groupChatHistoryRef.current = groupChatHistory;
  }, [groupChatHistory]);

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
      setSelectedId(null);
    }
  }, [event]);

  /**
   * 监听 Drawer 开合状态：打开时拉取最新会话列表并触感反馈，Mac 端处理 permanent/slide 模式切换。
   */
  useEffect(() => {
    if (isMac && isFirstRenderRef.current) {
      handleUpdateHistory();
      isFirstRenderRef.current = false;
      return;
    }
    if (isMac) {
      if (isSlideDrawerEnabledRef.current) {
        isSlideDrawerEnabledRef.current = false;
        return;
      }
      if (drawerTypeRef.current === 'permanent') {
        setTimeout(() => {
          setDrawerTypeRef.current('slide');
          navigation.dispatch(DrawerActions.toggleDrawer());
        }, 10);
      }
      isSlideDrawerEnabledRef.current = true;
    }

    if (drawerStatus === 'open') {
      trigger(HapticFeedbackTypes.soft);
      trigger(HapticFeedbackTypes.selection);
      handleUpdateHistory();
    } else {
      trigger(HapticFeedbackTypes.selection);
      trigger(HapticFeedbackTypes.soft);
    }
  }, [drawerStatus, navigation]);

  /**
   * 从服务器拉取会话列表并更新 UI。
   * 会话已按 updatedAt 降序排列，直接映射为 Chat[] 即可。
   */
  const handleUpdateHistory = async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      return;
    }
    try {
      const sessions = await fetchSessions(address, agentId);
      const chatList: Chat[] = sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
      }));
      chatHistoryRef.current = chatList;
      const flatListData = groupMessagesByDate(chatList);
      setGroupChatHistory(flatListData);
    } catch (e) {
      console.log(`[Drawer] fetchSessions failed: ${e}`);
    }
  };

  /**
   * Mac 端点击会话时将 Drawer 切为 permanent 模式（侧边栏常驻显示）。
   */
  const setDrawerToPermanent = () => {
    if (isMac && drawerType === 'slide') {
      setDrawerType('permanent');
    }
  };

  /**
   * 删除会话：先乐观更新 UI，再调服务器 API，失败时回滚。
   */
  const handleDelete = () => {
    const targetId = deleteIdRef.current;

    // 乐观更新 UI
    setGroupChatHistory((prev) => prev.filter((chat) => chat.id !== targetId));
    sendEvent('deleteChat', { id: targetId });

    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (address && agentId) {
      deleteSession(address, agentId, targetId).catch(() => {
        // 失败回滚：重新拉取完整列表
        console.log('[Drawer] deleteSession failed, reloading');
        handleUpdateHistory();
      });
    }

    trigger(HapticFeedbackTypes.soft);
    deleteIdRef.current = '';
  };

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={[isMac ? styles.macContainer : styles.safeArea]}>
      <FlatList
        data={groupChatHistory}
        style={styles.flatList}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          // id 以 '-' 开头的是虚拟标题行（如 "Today"、"Yesterday"）
          if (item.id.startsWith('-')) {
            return (
              <View style={styles.sectionContainer}>
                <View style={styles.sectionDivider} />
                <Text style={styles.sectionText}>{item.title}</Text>
              </View>
            );
          } else {
            // 正常会话行：点击跳转聊天页，长按弹出删除确认
            const isSelected = selectedId === item.id;
            return (
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => {
                  setSelectedId(item.id);
                  setDrawerToPermanent();
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
                style={[
                  styles.touch,
                  isSelected &&
                    (isMac ? styles.macTouchSelected : styles.touchSelected),
                ]}
              >
                <Text numberOfLines={1} style={styles.title}>
                  {item.title}
                </Text>
              </TouchableOpacity>
            );
          }
        }}
      />
      {/* 底部设置按钮 */}
      <TouchableOpacity
        style={styles.settingsTouch}
        onPress={() => {
          setDrawerToPermanent();
          navigation.navigate('Settings');
        }}
      >
        <Image
          source={
            isDark
              ? require('../assets/settings_dark.png')
              : require('../assets/settings.png')
          }
          style={styles.settingsLeftImg}
        />
        <Text style={styles.settingsText}>Settings</Text>
      </TouchableOpacity>
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
    /** 手机端侧边栏容器 */
    safeArea: {
      flex: 1,
      backgroundColor: colors.drawerBackground,
    },
    /** Mac 端侧边栏容器 */
    macContainer: {
      flex: 1,
      backgroundColor: colors.drawerBackgroundMac,
    },
    /** 底部设置按钮容器 */
    settingsTouch: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      alignItems: 'center',
      marginVertical: 12,
      paddingHorizontal: 18,
    },
    settingsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    settingsText: {
      fontSize: 16,
      marginHorizontal: 8,
      fontWeight: '500',
      color: colors.text,
    },
    settingsLeftImg: {
      width: 24,
      height: 24,
      borderRadius: 12,
    },
    /** 会话列表 FlatList */
    flatList: {
      marginVertical: 4,
    },
    /** 单个会话行的触摸区域 */
    touch: {
      paddingHorizontal: 8,
      paddingVertical: 12,
      marginHorizontal: 12,
      marginVertical: 2,
      borderRadius: 8,
    },
    /** 手机端选中会话的高亮背景 */
    touchSelected: {
      backgroundColor: colors.selectedBackground,
    },
    /** Mac 端选中会话的高亮背景 */
    macTouchSelected: {
      backgroundColor: colors.selectedBackgroundMac,
    },
    /** 日期分组标题容器（含分隔线 + 文字） */
    sectionContainer: {
      paddingHorizontal: 8,
      marginHorizontal: 12,
      marginVertical: 12,
    },
    /** 日期分组标题上方的分隔线 */
    sectionDivider: {
      height: 1,
      backgroundColor: colors.border,
    },
    /** 日期分组标题文字（如 "Today"、"Yesterday"） */
    sectionText: {
      marginTop: 17,
      fontSize: 14,
      color: colors.textSecondary,
    },
    /** 会话标题文字 */
    title: {
      fontSize: 16,
      color: colors.text,
    },
  });

export default CustomDrawerContent;
