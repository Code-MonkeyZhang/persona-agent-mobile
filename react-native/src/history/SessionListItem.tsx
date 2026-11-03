/**
 * @file SessionListItem.tsx
 * @description 会话列表项组件：点击切换会话，左滑露出整块红色删除按钮，点按删除。
 *   行结构与桌面端 SessionItem 同构：信号位绝对定位在左侧 gutter，标题列恒定与入口行文字同列。
 *   用 RNGH 经典版 Swipeable，按钮宽度走 onLayout 测量；菜单化操作待 SDK 升级后启用官方组件，另行成议题处理。
 *   展开协调走模块级登记，新行展开时收起上一个展开行，不经 React 状态，滑动全程零重渲染。
 */
import * as React from 'react';
import { useCallback, useEffect } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Chat, ChatStatus } from '../types/Chat.ts';
import { useTheme, ColorScheme, typography } from '../theme/index.ts';
import { useChatStore } from '../stores/chatStore';
import { SignalSlot } from '../component/SignalSlot.tsx';
import { trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';

/** 删除按钮宽度，红底块与行同高 */
const DELETE_ACTION_WIDTH = 64;

/** 当前展开行的收起函数登记位，新行展开时调用它收起旧行，实现同时只开一个 */
let closeOpenedRow: (() => void) | null = null;

interface SessionListItemProps {
  item: Chat;
  onPress: (item: Chat) => void;
  onDelete: (id: string) => void;
}

const SessionListItem: React.FC<SessionListItemProps> = ({
  item,
  onPress,
  onDelete,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const swipeableRef = React.useRef<Swipeable>(null);
  /** 本行收起函数的留存引用，供卸载清理时比对登记身份 */
  const selfCloseRef = React.useRef<(() => void) | null>(null);

  // 运行腿经 store 自订阅,集合加本机取或,props 维持纯数据行,memo 隔离不受损
  const running = useChatStore(
    (s) =>
      s.runningSessions.includes(item.id) ||
      s.sessions[item.id]?.status === ChatStatus.Running
  );

  const performDelete = useCallback(() => {
    trigger(HapticFeedbackTypes.notificationWarning);
    onDelete(item.id);
  }, [item.id, onDelete]);

  /** 新行展开时收起上一个展开行并接管登记位，自己已在登记位时不动 */
  const handleWillOpen = useCallback(() => {
    const close = swipeableRef.current?.close;
    if (!close) {
      return;
    }
    if (closeOpenedRow && closeOpenedRow !== close) {
      closeOpenedRow();
    }
    closeOpenedRow = close;
  }, []);

  /** 收起的正是登记行时清空登记位，别的行借位收起不影响下一个展开行 */
  const handleClose = useCallback(() => {
    if (closeOpenedRow && closeOpenedRow === swipeableRef.current?.close) {
      closeOpenedRow = null;
    }
  }, []);

  // 行在展开态被删除或换数据源卸载时让出登记位，避免后续展开行调用已卸载实例
  useEffect(() => {
    selfCloseRef.current = swipeableRef.current?.close ?? null;
    return () => {
      if (closeOpenedRow && closeOpenedRow === selfCloseRef.current) {
        closeOpenedRow = null;
      }
    };
  }, []);

  return (
    <Swipeable
      ref={swipeableRef}
      containerStyle={styles.swipeable}
      renderRightActions={(progress) => {
        // 图标随展开进度缩放渐入，progress 从关闭的 0 到完全展开的 1
        const scale = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        });
        return (
          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('home.delete')}
            onPress={performDelete}
            style={styles.deleteAction}
          >
            <Animated.View style={{ opacity: scale, transform: [{ scale }] }}>
              <X size={24} color={colors.primaryForeground} />
            </Animated.View>
          </TouchableOpacity>
        );
      }}
      onSwipeableWillOpen={handleWillOpen}
      onSwipeableClose={handleClose}
    >
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onPress(item)}
        style={styles.touch}
      >
        {/* 运行与未读收敛到行首 gutter 同一个信号位,锚区铺满行高内部居中,标题列恒定不移。
            未读纯查数据,在场判定由服务端轮末完成,渲染侧不二次抑制 */}
        <View pointerEvents="none" style={styles.signalAnchor}>
          <SignalSlot running={running} unread={Boolean(item.hasUnread)} />
        </View>
        <Text numberOfLines={1} style={styles.title}>
          {item.title}
        </Text>
      </TouchableOpacity>
    </Swipeable>
  );
};

/** 列表项样式工厂。圆角与外边距放在 swipeable 容器上，配合其 overflow hidden
 *  让红色删除块与行保持一致的圆角。 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    swipeable: {
      marginHorizontal: 10,
      marginVertical: 2,
      borderRadius: 12,
    },
    /** 标题列恒定 54：轨道边距 10 加左内边距 44，与上方入口行文字起点同列 */
    touch: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 44,
      paddingRight: 12,
      paddingVertical: 10,
      borderRadius: 12,
    },
    /** 信号位锚区,绝对定位铺满行高,top 与 bottom 拉伸不依赖百分比定位,内部居中放信号位 */
    signalAnchor: {
      position: 'absolute',
      left: 12,
      top: 0,
      bottom: 0,
      width: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      ...typography.titleDisplay,
      color: colors.text,
    },
    /** 右滑露出的删除区，整块红底白 X。Swipeable 靠 onLayout 量此宽度决定滑出距离，
     *  必须给固定宽度，禁止 flex 撑满 */
    deleteAction: {
      width: DELETE_ACTION_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.error,
    },
  });

export default React.memo(SessionListItem);
