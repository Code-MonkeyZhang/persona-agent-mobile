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
  const [groupChatHistory, setGroupChatHistory] = useState<Chat[]>([]);
  const groupChatHistoryRef = useRef(groupChatHistory);
  const chatHistoryRef = useRef<Chat[]>([]);
  const [showDialog, setShowDialog] = useState<boolean>(false);
  const deleteIdRef = useRef<string>('');
  const drawerStatus = useDrawerStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tapIndexRef = useRef<number>(1);
  const isFirstRenderRef = useRef<boolean>(true);
  const isSlideDrawerEnabledRef = useRef<boolean>(false);
  const { event, sendEvent } = useAppContext();
  const { drawerType, setDrawerType } = useAppContext();

  const drawerTypeRef = useRef(drawerType);
  const setDrawerTypeRef = useRef(setDrawerType);
  useEffect(() => {
    drawerTypeRef.current = drawerType;
  }, [drawerType]);

  useEffect(() => {
    groupChatHistoryRef.current = groupChatHistory;
  }, [groupChatHistory]);

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
    }
  }, [event]);

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
        ListHeaderComponent={
          <View>
            <TouchableOpacity
              style={styles.settingsTouch}
              onPress={() => {
                setDrawerToPermanent();
                navigation.navigate('Bedrock', {
                  sessionId: '',
                  tapIndex: -1,
                });
              }}
            >
              <Image
                source={
                  isDark
                    ? require('../assets/edit_dark.png')
                    : require('../assets/edit.png')
                }
                style={styles.settingsLeftImg}
              />
              <Text style={styles.settingsText}>Chat</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          if (item.id.startsWith('-')) {
            return (
              <View style={styles.sectionContainer}>
                <View style={styles.sectionDivider} />
                <Text style={styles.sectionText}>{item.title}</Text>
              </View>
            );
          } else {
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

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.drawerBackground,
    },
    macContainer: {
      flex: 1,
      backgroundColor: colors.drawerBackgroundMac,
    },
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

    flatList: {
      marginVertical: 4,
    },
    touch: {
      paddingHorizontal: 8,
      paddingVertical: 12,
      marginHorizontal: 12,
      marginVertical: 2,
      borderRadius: 8,
    },
    touchSelected: {
      backgroundColor: colors.selectedBackground,
    },
    macTouchSelected: {
      backgroundColor: colors.selectedBackgroundMac,
    },
    sectionContainer: {
      paddingHorizontal: 8,
      marginHorizontal: 12,
      marginVertical: 12,
    },
    sectionDivider: {
      height: 1,
      backgroundColor: colors.border,
    },
    sectionText: {
      marginTop: 17,
      fontSize: 14,
      color: colors.textSecondary,
    },
    title: {
      fontSize: 16,
      color: colors.text,
    },
  });

export default CustomDrawerContent;
