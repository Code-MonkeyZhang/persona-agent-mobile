/**
 * @file ActionSheet.tsx
 * @description 底部选择器。
 *   基于 @gorhom/bottom-sheet 的 BottomSheetModal，挂载即弹出，
 *   遮罩随面板位置原地淡入，点遮罩或下拉拖拽条收起，收起完成走 onDismiss 回调 onClose，
 *   选中项经 handle 的 dismiss 带动画收起，高度固定不随内容变化，列表在面板内部滚动，
 *   分组标签与选项行配套输出，选项行支持等宽字体，长相基准是 demo NavDetailShared 的同名家族。
 */
import React, { useEffect, useRef } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Check } from 'lucide-react-native';
import {
  useTheme,
  ColorScheme,
  typography,
  monoFont,
} from '../../theme/index.ts';

/** 面板高度占屏比的默认档，长列表弹层用 */
const DEFAULT_SNAP_POINT = '62%';

/** 弹层组件的实例类型，经组件 ref 推断取得 */
type SheetInstance = React.ComponentRef<typeof BottomSheetModal>;

/** 调用方收起弹层的句柄，dismiss 动画结束后触发 onDismiss */
export type ActionSheetHandle = Pick<SheetInstance, 'dismiss'>;

/** 遮罩随面板位置淡入淡出，点按走 close 收起整个弹层 */
const SheetBackdrop = (
  props: React.ComponentProps<typeof BottomSheetBackdrop>
) => (
  <BottomSheetBackdrop
    {...props}
    appearsOnIndex={0}
    disappearsOnIndex={-1}
    pressBehavior="close"
  />
);

interface ActionSheetProps {
  title: string;
  /** 面板高度占屏比，默认 62%，短内容弹层传矮档 */
  snapPoint?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** 底部选择器：挂载自动弹出，Android 返回键收起面板 */
export const ActionSheet = React.forwardRef<
  ActionSheetHandle,
  ActionSheetProps
>(function ActionSheetBase({ title, snapPoint, onClose, children }, ref) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const sheetRef = useRef<SheetInstance>(null);

  useEffect(() => {
    sheetRef.current?.present();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sheetRef.current?.dismiss();
      return true;
    });
    return () => sub.remove();
  }, []);

  React.useImperativeHandle(ref, () => ({
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={[snapPoint ?? DEFAULT_SNAP_POINT]}
      enableDynamicSizing={false}
      onDismiss={onClose}
      backdropComponent={SheetBackdrop}
      backgroundStyle={styles.panel}
      handleIndicatorStyle={styles.dragBar}
    >
      <Text style={styles.title}>{title}</Text>
      <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
ActionSheet.displayName = 'ActionSheet';

/** 选择器内的分组小标签 */
export function SheetGroupLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return <Text style={styles.groupLabel}>{children}</Text>;
}

/** 选择器内的选项行：主文案加灰色副文案，选中项行尾主题色对勾，mono 用等宽主文案 */
export function SheetOption({
  label,
  sub,
  selected,
  mono,
  onPress,
}: {
  label: string;
  sub?: string;
  selected?: boolean;
  mono?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <TouchableOpacity
      style={styles.optionRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[styles.optionLabel, mono ? styles.optionLabelMono : undefined]}
      >
        {label}
      </Text>
      {sub ? <Text style={styles.optionSub}>{sub}</Text> : null}
      {selected ? (
        <Check size={16} color={colors.primary} style={styles.optionCheck} />
      ) : null}
    </TouchableOpacity>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    panel: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    dragBar: {
      backgroundColor: colors.borderLight,
    },
    title: {
      ...typography.body,
      fontWeight: '600',
      color: colors.text,
      paddingHorizontal: 16,
      marginBottom: 4,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 28,
    },
    groupLabel: {
      ...typography.tertiary,
      color: colors.textTertiary,
      marginTop: 10,
      marginBottom: 2,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
    },
    optionLabel: {
      ...typography.content,
      color: colors.text,
    },
    optionLabelMono: {
      fontFamily: monoFont,
    },
    optionSub: {
      ...typography.caption,
      color: colors.textTertiary,
      marginLeft: 6,
    },
    optionCheck: {
      marginLeft: 'auto',
    },
  });
