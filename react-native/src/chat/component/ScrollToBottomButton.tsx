/**
 * @file ScrollToBottomButton.tsx
 * @description 回底按钮，锚定在输入栏包装节点上方的绝对定位子节点。
 *   - 形态对齐桌面端 ScrollToBottomButton，半透明白底叠毛玻璃加细边框加轻阴影
 *   - 显隐由 useChatScroll 派生的 visible 驱动，过渡参数与桌面 framer-motion 一致
 *   - 减弱动态效果开启时过渡时长归零，尊重系统无障碍设置
 */
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ArrowDown } from 'lucide-react-native';
import BackdropBlur from '../../component/BackdropBlur.tsx';
import { useTheme } from '../../theme/index.ts';

/** 按钮直径，与桌面端同尺寸 */
const BUTTON_SIZE = 36;

/** 按钮下缘距输入栏顶边的净空 */
const BUTTON_CLEARANCE = 44;

/** 浮现过渡时长，对齐桌面端 easeOut 段 */
const SHOW_DURATION = 200;

/** 消失过渡时长，对齐桌面端 easeIn 段 */
const HIDE_DURATION = 150;

/** 过渡的纵向行程，浮现自下方浮入，消失向下沉出 */
const SLIDE_DISTANCE = 8;

interface ScrollToBottomButtonProps {
  /** 是否可见，由滚动偏移跨阈值与陪伴页状态共同决定 */
  visible: boolean;
  /** 点击回底，由调用方传入现成的 scrollToBottom */
  onPress: () => void;
}

/**
 * 回底按钮，常驻渲染由动画驱动显隐。
 * - 外层 Animated.View 持锚定与 iOS 投影，投影依赖不被裁剪的图层
 * - 内层圆形节点 overflow hidden 裁剪毛玻璃，安卓不设 elevation，
 *   轮廓投影与透明度动画合成不同步会让浮现呈分层感
 * - 不可见时 pointerEvents 立即禁用，退场淡出途中不会误触
 * - 键盘抬升时随浮层动画逐帧跟随，位置由布局回答
 */
export const ScrollToBottomButton = ({
  visible,
  onPress,
}: ScrollToBottomButtonProps): React.JSX.Element => {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(SLIDE_DISTANCE);

  useEffect(() => {
    const duration = reduceMotion ? 0 : visible ? SHOW_DURATION : HIDE_DURATION;
    const easing = visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic);
    opacity.value = withTiming(visible ? 1 : 0, { duration, easing });
    translateY.value = withTiming(visible ? 0 : SLIDE_DISTANCE, {
      duration,
      easing,
    });
  }, [visible, reduceMotion, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[styles.anchor, animatedStyle]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Pressable onPress={onPress} hitSlop={8} style={styles.button}>
        <BackdropBlur />
        <ArrowDown size={18} color={colors.textSecondary} />
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    top: -(BUTTON_SIZE + BUTTON_CLEARANCE),
    right: 16,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOpacity: 0.1,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 6,
      },
    }),
  },
  button: {
    flex: 1,
    borderRadius: BUTTON_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
