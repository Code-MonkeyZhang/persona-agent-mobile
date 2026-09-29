/**
 * @file ActionSheet.tsx
 * @description 底部选择器。
 *   遮罩点击收起，面板随 Modal 上滑进屏，内容超高可滚动，
 *   分组标签与选项行配套输出，长相基准是 demo NavDetailShared 的同名家族。
 */
import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme, ColorScheme } from '../../theme/index.ts';

/** 底部选择器：标题带上提面板，遮罩点击收起 */
export function ActionSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <Modal
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.panel}>
          <View style={styles.dragBar} />
          <Text style={styles.title}>{title}</Text>
          <ScrollView>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** 选择器内的分组小标签 */
export function SheetGroupLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return <Text style={styles.groupLabel}>{children}</Text>;
}

/** 选择器内的选项行：主文案加灰色副文案，选中项行尾主题色对勾 */
export function SheetOption({
  label,
  sub,
  selected,
  onPress,
}: {
  label: string;
  sub?: string;
  selected?: boolean;
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
      <Text style={styles.optionLabel}>{label}</Text>
      {sub ? <Text style={styles.optionSub}>{sub}</Text> : null}
      {selected ? (
        <Check size={16} color={colors.primary} style={styles.optionCheck} />
      ) : null}
    </TouchableOpacity>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'flex-end',
    },
    panel: {
      maxHeight: '62%',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      backgroundColor: colors.card,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 28,
    },
    dragBar: {
      alignSelf: 'center',
      width: 34,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderLight,
      marginBottom: 12,
    },
    title: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 4,
    },
    groupLabel: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 10,
      marginBottom: 2,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    optionLabel: {
      fontSize: 14,
      color: colors.text,
    },
    optionSub: {
      fontSize: 12,
      color: colors.textTertiary,
      marginLeft: 6,
    },
    optionCheck: {
      marginLeft: 'auto',
    },
  });
