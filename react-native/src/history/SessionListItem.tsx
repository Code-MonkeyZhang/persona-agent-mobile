/**
 * @file SessionListItem.tsx
 * @description 会话列表项组件：点击切换会话，左滑露出整块红色删除按钮，点按删除。
 *   用 RNGH 经典版 Swipeable，按钮宽度走 onLayout 测量。应用当前是旧架构，
 *   ReanimatedSwipeable 靠 worklet 内同步测量取宽，旧架构上量不到导致松手永远回弹，
 *   故弃用，升新架构后可再切回。
 *   展开协调走模块级登记，新行展开时收起上一个展开行，不经 React 状态，滑动全程零重渲染。
 */
import * as React from 'react';
import { useCallback, useEffect } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Chat } from '../types/Chat.ts';
import { useTheme, ColorScheme, typography } from '../theme/index.ts';
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
      marginHorizontal: 12,
      marginVertical: 2,
      borderRadius: 8,
    },
    /** 左边距 42 复刻主页行图标加间距的占位宽度，会话标题与四行入口文字同列 */
    touch: {
      paddingLeft: 42,
      paddingRight: 16,
      paddingVertical: 12,
      borderRadius: 8,
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
