/**
 * @file PhoneAppBar.tsx
 * @description 小手机应用内实体顶栏。AppSurface 与 PhoneSettings 共用，
 *   白底加发丝下边线占位，内容从 header 下沿开始排。
 *   左右圆钮由 PhoneChip 统一承载，白底上用深档保证对比度，
 *   中间半透明药丸装 AppTile 迷你图标与标题，footer 槽位放进度线或状态条。
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Smartphone } from 'lucide-react-native';
import { typography, useTheme } from '../../theme/index.ts';

interface PhoneAppBarProps {
  /** 药丸标题 */
  title: string;
  /** 药丸里的迷你图标，App 传应用数据，内置槽位传齿轮 */
  tile: React.ReactNode;
  /** 左钮动作，AppSurface 返回上一屏，PhoneSettings 逐层退 */
  onBack: () => void;
  /** 右钮动作，统一语义为直回小手机桌面 */
  onGrid: () => void;
  /** 顶栏下方的附加行，进度线或状态条 */
  footer?: React.ReactNode;
}

/**
 * 悬浮圆钮，桌面屏与 App 内顶栏共用同一规格。
 * solid 为白底上的深档，缺省浅档供壁纸上的悬浮钮使用。
 */
export function PhoneChip({
  children,
  onPress,
  solid,
}: {
  children: React.ReactNode;
  onPress: () => void;
  solid?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, solid && styles.chipSolid]}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {children}
    </TouchableOpacity>
  );
}

const PhoneAppBar: React.FC<PhoneAppBarProps> = ({
  title,
  tile,
  onBack,
  onGrid,
  footer,
}) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const bandStyle = [
    styles.band,
    {
      backgroundColor: colors.background,
      borderBottomColor: colors.borderLight,
    },
  ];
  return (
    <View style={bandStyle}>
      <View style={[styles.row, { paddingTop: insets.top + 6 }]}>
        <PhoneChip solid onPress={onBack}>
          <ChevronLeft size={22} color="#ffffff" />
        </PhoneChip>
        <View style={styles.pill}>
          {tile}
          <Text style={styles.pillTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <PhoneChip solid onPress={onGrid}>
          <Smartphone size={20} color="#ffffff" />
        </PhoneChip>
      </View>
      {footer}
    </View>
  );
};

const styles = StyleSheet.create({
  band: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  chip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(20,30,40,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSolid: {
    backgroundColor: 'rgba(20,30,40,0.65)',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: 190,
    paddingLeft: 5,
    paddingRight: 12,
    paddingVertical: 4,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(22,32,46,0.08)',
    shadowColor: '#16202e',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
  pillTitle: {
    ...typography.content,
    fontWeight: '600',
    color: '#16202e',
  },
});

export default PhoneAppBar;
