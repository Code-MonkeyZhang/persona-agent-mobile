/**
 * @file BrandMark.tsx
 * @description 品牌图标组件，是桌面端 common/ProviderMark.tsx 的 RN 版，两个仓没有共享包所以抄录。
 *   浅色底圆角 chip + lobe-icons 图标，查不到映射时回退首字母 monogram
 *   分两层：ProviderMark 按供应商 id 查渠道图标；ModelMark 按 modelId 查产品图标，
 *   模型未命中时回退供应商图标，语义是「经此渠道供应的未知模型」
 *   底色默认浅色，Mono 图标锁深色，保证任何主题下都可读，颜色取本端 token。
 *   表里自带深色底的条目底色跟随条目，图标取白色前景，与桌面端的黑底白字徽标长得一样
 */
import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/index.ts';
import { PROVIDER_ICONS } from '../lib/providerIcons.ts';
import { findModelIcon } from '../lib/modelIcons.ts';

/** chip 的圆角上限，与桌面端的圆角档一致，尺寸比两倍圆角还小时取一半即正圆 */
const CHIP_RADIUS = 10;

interface IconEntry {
  Icon: ComponentType<{ size?: number; color?: string }>;
  mono: boolean;
  background?: string;
}

interface BrandMarkProps {
  entry: IconEntry | null;
  /** monogram 兜底时取首字母的名字 */
  name: string;
  /** chip 尺寸，默认 20 */
  size?: number;
}

/** 通用品牌图标 chip，entry 为 null 时渲染首字母 monogram */
function BrandMark({ entry, name, size = 20 }: BrandMarkProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          width: size,
          height: size,
          borderRadius: Math.min(CHIP_RADIUS, size / 2),
          borderColor: colors.border,
          backgroundColor: entry?.background ?? colors.surfaceSecondary,
        },
      ]}
    >
      {entry ? (
        <entry.Icon
          size={Math.round(size * 0.6)}
          // 带深色底的条目取白色前景，两端的黑底白字徽标因此长得一样。
          // RN 版图标包把彩色图标画成传入的颜色，不传时取黑色，桌面端用的网页版同一图标默认画白色。
          color={
            entry.background
              ? '#fff'
              : entry.mono
              ? colors.textDarkGray
              : undefined
          }
        />
      ) : (
        <Text
          style={[
            styles.monogram,
            { fontSize: size * 0.5, color: colors.textTertiary },
          ]}
        >
          {name[0]}
        </Text>
      )}
    </View>
  );
}

interface ProviderMarkProps {
  /** 供应商 id，用于查注册表 */
  providerId: string;
  /** 供应商显示名，monogram 兜底时取首字母 */
  name: string;
  size?: number;
}

/** 供应商渠道图标，按 providerId 查注册表 */
export function ProviderMark({ providerId, name, size }: ProviderMarkProps) {
  return (
    <BrandMark
      entry={PROVIDER_ICONS[providerId] ?? null}
      name={name}
      size={size}
    />
  );
}

interface ModelMarkProps {
  /** 模型 id，用于查关键词映射表 */
  modelId: string;
  /** 供应商 id，模型未命中时回退其渠道图标 */
  providerId: string;
  /** 供应商显示名，monogram 兜底时取首字母 */
  name: string;
  size?: number;
}

/** 模型产品图标，modelId 未命中回退供应商图标，再未命中走 monogram */
export function ModelMark({ modelId, providerId, name, size }: ModelMarkProps) {
  const entry = findModelIcon(modelId) ?? PROVIDER_ICONS[providerId] ?? null;
  return <BrandMark entry={entry} name={name} size={size} />;
}

const styles = StyleSheet.create({
  /** 浅色底圆角 chip，描边取主题线条色，尺寸与圆角由使用处传入 */
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  monogram: {
    fontWeight: '600',
  },
});
