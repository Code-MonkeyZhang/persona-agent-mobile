/**
 * @file AgentSelectionModal.tsx
 * @description Agent 选择下拉菜单，从触发按钮下方展开，支持高度 + 透明度动画。
 * 选中项通过背景色高亮，点击外部区域关闭。
 */
import React, { useCallback, useEffect } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme, ColorScheme } from '../../theme';
import type { AgentInfo } from '../../api/nano-agent-api';

/** 下拉菜单 Props */
interface AgentSelectionModalProps {
  /** 是否显示菜单 */
  visible: boolean;
  /** 关闭菜单的回调 */
  onClose: () => void;
  /** 菜单左上角的屏幕坐标，由 AgentSelector 通过 measure() 计算得出 */
  iconPosition: { x: number; y: number };
  /** 可选 Agent 列表 */
  agents: AgentInfo[];
  /** 当前选中的 Agent ID */
  currentAgentId: string;
  /** 切换 Agent 时的回调 */
  onSelectAgent: (agentId: string) => void;
}

/** 菜单最大高度 */
const MODAL_HEIGHT = 200;
/** 展开/收起动画时长 (ms) */
const ANIMATION_DURATION = 250;

/**
 * 头像背景色预设列表，与 AgentSelector 保持一致。
 */
const AVATAR_COLORS = [
  '#4A90D9',
  '#50B86C',
  '#E8913A',
  '#D45B5B',
  '#9B59B6',
  '#1ABC9C',
  '#E67E22',
  '#3498DB',
];

/** 根据名称首字符确定头像背景色 */
function getAvatarColor(name: string): string {
  const code = name.charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

/**
 * Agent 选择下拉菜单。
 *
 * 交互流程：
 * 1. visible 变为 true 时，触发展开动画（高度 0 → MODAL_HEIGHT，透明度 0 → 1）
 * 2. 用户选择 Agent 或点击遮罩层时，触发收起动画（动画结束后调用 onClose）
 *
 * 设计特点：
 * - 无标题栏、无分割线，选中项通过背景色高亮
 * - 使用 Reanimated 的 useSharedValue 驱动动画，在 JS 线程执行关闭回调
 */
const AgentSelectionModal: React.FC<AgentSelectionModalProps> = ({
  visible,
  onClose,
  iconPosition,
  agents,
  currentAgentId,
  onSelectAgent,
}) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  /** 动画驱动：菜单高度，0 = 收起，MODAL_HEIGHT = 展开 */
  const heightValue = useSharedValue(0);
  /** 动画驱动：菜单内容透明度 */
  const opacityValue = useSharedValue(0);

  /** 展开动画：高度和透明度从 0 过渡到目标值 */
  const startOpenAnimation = useCallback(() => {
    heightValue.value = 0;
    opacityValue.value = 0;
    heightValue.value = withTiming(MODAL_HEIGHT, {
      duration: ANIMATION_DURATION,
    });
    opacityValue.value = withTiming(1, { duration: ANIMATION_DURATION });
  }, [heightValue, opacityValue]);

  /**
   * 收起动画：高度和透明度过渡到 0，动画结束后通过 runOnJS 在 JS 线程执行回调。
   * 必须使用 runOnJS，因为 withTiming 的回调在 UI 线程执行，不能直接调用 JS 侧的 setState。
   */
  const startCloseAnimation = useCallback(
    (callback: () => void) => {
      heightValue.value = withTiming(0, { duration: ANIMATION_DURATION });
      opacityValue.value = withTiming(
        0,
        { duration: ANIMATION_DURATION },
        () => {
          runOnJS(callback)();
        }
      );
    },
    [heightValue, opacityValue]
  );

  /** visible 变为 true 时启动展开动画 */
  useEffect(() => {
    if (visible) {
      startOpenAnimation();
    }
  }, [startOpenAnimation, visible]);

  /** 点击遮罩层关闭：播放收起动画，动画结束后调用 onClose */
  const handleClose = () => {
    startCloseAnimation(onClose);
  };

  /** 点击 Agent 项：播放收起动画，关闭菜单后触发选择回调 */
  const handleAgentSelect = (agentId: string) => {
    startCloseAnimation(() => {
      onClose();
      if (agentId !== currentAgentId) {
        onSelectAgent(agentId);
      }
    });
  };

  /** 将动画值映射为样式：高度 + 透明度 */
  const animatedStyle = useAnimatedStyle(() => ({
    height: heightValue.value,
    opacity: opacityValue.value,
  }));

  /** 渲染单个 Agent 列表项 */
  const renderAgentItem = ({ item }: { item: AgentInfo }) => {
    const isSelected = item.id === currentAgentId;
    const agentInitial = item.name.charAt(0).toUpperCase();

    return (
      <TouchableOpacity
        style={[styles.agentItem, isSelected && styles.agentItemSelected]}
        onPress={() => handleAgentSelect(item.id)}
        activeOpacity={0.6}
      >
        <View
          style={[
            styles.agentIcon,
            { backgroundColor: getAvatarColor(item.name) },
          ]}
        >
          <Text style={styles.agentIconText}>{agentInitial}</Text>
        </View>
        <Text style={styles.agentName}>{item.name}</Text>
      </TouchableOpacity>
    );
  };

  if (!visible) {
    return null;
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {/* 全屏遮罩层，点击关闭菜单 */}
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.modalOverlay}>
          {/* 内层拦截触摸事件，防止点击 Agent 项时同时触发关闭 */}
          <TouchableWithoutFeedback>
            <Animated.View
              style={[
                styles.modalContainer,
                animatedStyle,
                // eslint-disable-next-line react-native/no-inline-styles
                {
                  position: 'absolute',
                  left: iconPosition.x,
                  top: iconPosition.y,
                },
              ]}
            >
              <FlatList
                data={agents}
                renderItem={renderAgentItem}
                keyExtractor={(item) => item.id}
              />
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

/** 样式工厂函数 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    /** 全屏半透明遮罩 */
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.1)',
    },
    /** 菜单容器：圆角卡片 + 阴影 */
    modalContainer: {
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingVertical: 4,
      width: 220,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderLight,
    },
    /** 单个 Agent 项 */
    agentItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    /** 选中的 Agent 项高亮背景 */
    agentItemSelected: {
      backgroundColor: colors.selectedBackground,
    },
    agentIcon: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    agentIconText: {
      color: '#ffffff',
      fontSize: 11,
      fontWeight: '600',
    },
    agentName: {
      fontSize: 15,
      flex: 1,
      color: colors.text,
    },
  });

export default AgentSelectionModal;
