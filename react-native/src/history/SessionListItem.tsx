/**
 * @file SessionListItem.tsx
 * @description 会话列表项组件：点击切换会话，左滑露出删除按钮直接删除（无确认弹窗）。
 *   基于 RNGH 的 ReanimatedSwipeable（Reanimated 3 worklet 驱动）：
 *   - 轻滑：露出一个红色 X，点击即删。
 *   - 满滑：基于行宽相对判定（剩余可见宽度 ≤ 阈值即触发），判定跑在 UI 线程，比固定像素阈值更准。
 *   - 同一时间只允许一项展开：由父组件通过 openId 协调（见 CustomDrawerContent）。
 */
import * as React from 'react';
import { useCallback, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Chat } from '../types/Chat.ts';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';

/** 删除按钮宽度（仅红色 X，无背景） */
const DELETE_ACTION_WIDTH = 52;
/** 满滑判定：行剩余可见宽度 ≤ 该值时触发直接删除（值越小需滑得越彻底） */
const FULL_SWIPE_REMAINING = 80;

interface SessionListItemProps {
  item: Chat;
  isSelected: boolean;
  /** 当前展开的会话 id（由父组件协调“同时只开一个”）；非本项时自动收起 */
  openId: string | null;
  onPress: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 右滑露出的删除按钮。独立成组件，以便在 worklet 中读取 translation / 行宽做满滑判定
 * （直接在 renderRightActions 的函数体里用 hook 会违反 rules-of-hooks）。
 */
const DeleteAction: React.FC<{
  translation: SharedValue<number>;
  rowWidth: SharedValue<number>;
  onPress: () => void;
}> = ({ translation, rowWidth, onPress }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  /** 防止删除被重复触发（满滑 + 按钮点击可能并发） */
  const hasSwiped = useSharedValue(false);

  const fireOnce = useCallback(() => {
    if (!hasSwiped.value) {
      hasSwiped.value = true;
      onPress();
    }
  }, [hasSwiped, onPress]);

  // 满滑判定：剩余可见宽度 = 行宽 + translation（右滑时 translation 为负）。
  // 跑在 UI 线程，越过阈值即通过 runOnJS 触发删除。行宽尚未量得（=0）时跳过。
  useAnimatedReaction(
    () => rowWidth.value + translation.value,
    (visible) => {
      if (rowWidth.value > 0 && visible <= FULL_SWIPE_REMAINING) {
        runOnJS(fireOnce)();
      }
    }
  );

  return (
    <View style={styles.deleteAction}>
      <TouchableOpacity
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('drawer.delete')}
        onPress={fireOnce}
        style={styles.deleteButton}
      >
        <X size={24} color={colors.error} />
      </TouchableOpacity>
    </View>
  );
};

const SessionListItem: React.FC<SessionListItemProps> = ({
  item,
  isSelected,
  openId,
  onPress,
  onOpen,
  onDelete,
}) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const swipeableRef = React.useRef<SwipeableMethods>(null);
  /** 行宽（onLayout 量得），供 DeleteAction 做满滑判定 */
  const rowWidth = useSharedValue(0);

  const performDelete = useCallback(() => {
    trigger(HapticFeedbackTypes.notificationWarning);
    onDelete(item.id);
  }, [item.id, onDelete]);

  // “同时只开一个”：父组件 openId 变化且不是本项时收起自己
  useEffect(() => {
    if (openId !== null && openId !== item.id) {
      swipeableRef.current?.close();
    }
  }, [openId, item.id]);

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      containerStyle={styles.swipeable}
      rightThreshold={26}
      renderRightActions={(_progress, translation) => (
        <DeleteAction
          translation={translation}
          rowWidth={rowWidth}
          onPress={performDelete}
        />
      )}
      onSwipeableWillOpen={() => onOpen(item.id)}
    >
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onLayout={(e) => {
          rowWidth.value = e.nativeEvent.layout.width;
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
    </ReanimatedSwipeable>
  );
};

/** 列表项样式工厂。圆角与外边距放在 swipeable 容器上，配合其 overflow:hidden
 *  让露出删除按钮时与行保持一致的圆角。 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    swipeable: {
      marginHorizontal: 12,
      marginVertical: 2,
      borderRadius: 8,
    },
    touch: {
      paddingLeft: 28,
      paddingRight: 16,
      paddingVertical: 12,
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
    /** 右滑露出的删除区（由 ReanimatedSwipeable 的 absoluteFill 容器自动撑满行高）。
     *  仅放一个红色 X，无背景，露出时显示抽屉原色。 */
    deleteAction: {
      width: DELETE_ACTION_WIDTH,
    },
    deleteButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

export default SessionListItem;
