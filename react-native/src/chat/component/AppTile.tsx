/**
 * @file AppTile.tsx
 * @description 小手机统一图标格。内置槽位与 Agent App 共用同一副白瓷外壳，
 *   内容三型，logo 图直接铺满、无图应用用名字哈希渐变加首字回退、内置槽位渲染齿轮。
 *   外壳不随壁纸深浅换料，圆角与投影随尺寸等比缩放，小尺寸关闭投影避免叠影。
 */
import * as React from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Settings } from 'lucide-react-native';
import CachedImage from '../../component/CachedImage';

interface AppTileProps {
  /** 机器键，哈希取色与首字回退的数据源，settings 槽位可省 */
  name?: string;
  /** 显示名，兜底字母从这里取首字，缺省回落 name */
  label?: string;
  /** 带内容哈希的图标地址，缺省渲染渐变回退 */
  logoUrl?: string;
  /** settings 渲染内置齿轮槽位，忽略应用数据 */
  kind?: 'app' | 'settings';
  size: number;
}

/** 十档渐变取色板，名字哈希取模落档，同一应用永远同色 */
const GRADIENTS: [string, string][] = [
  ['#fa5252', '#ff8787'],
  ['#f76707', '#ffa94d'],
  ['#12b886', '#38d9a9'],
  ['#4c6ef5', '#748ffc'],
  ['#e64980', '#f783ac'],
  ['#7048e8', '#9775fa'],
  ['#0ca678', '#20c997'],
  ['#f59f00', '#ffd43b'],
  ['#228be6', '#4dabf7'],
  ['#496dd0', '#91a7ff'],
];

/** 字符串定值哈希，同名入参恒定输出，供取色与 svg 渐变 id 共用 */
function hashName(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    sum = (sum * 31 + name.charCodeAt(i)) % 998244353;
  }
  return sum;
}

/**
 * 对角双档渐变底。svg 的 gradient id 由名字哈希派生，
 * 同名实例共享同一定义，跨实例引用同一份颜色无害。
 */
function GradientBase({ name, size }: { name: string; size: number }) {
  const [from, to] = GRADIENTS[hashName(name) % GRADIENTS.length];
  const id = `tileGrad${hashName(name)}`;
  return (
    <Svg
      width={size}
      height={size}
      style={styles.gradient}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  );
}

const AppTile: React.FC<AppTileProps> = ({
  name,
  label,
  logoUrl,
  kind = 'app',
  size,
}) => {
  const [iconError, setIconError] = useState(false);
  const radius = size * 0.25;
  const shellStyle = [
    styles.shell,
    {
      width: size,
      height: size,
      borderRadius: radius,
      borderColor:
        kind === 'settings' ? 'rgba(22,32,46,0.08)' : 'rgba(22,32,46,0.10)',
      backgroundColor: kind === 'settings' ? '#f3f5f8' : '#ffffff',
      shadowOpacity: size >= 40 ? 0.12 : 0,
      elevation: size >= 40 ? 3 : 0,
    },
  ];
  const imageStyle = [
    styles.image,
    { width: size, height: size, borderRadius: radius },
  ];
  const letterStyle = [styles.letter, { fontSize: size * 0.4 }];
  return (
    <View style={shellStyle}>
      {kind === 'settings' ? (
        <Settings size={size * 0.46} color="#5c6470" />
      ) : (
        <>
          <GradientBase name={name ?? ''} size={size} />
          <Text style={letterStyle}>
            {(label ?? name ?? '').charAt(0).toUpperCase()}
          </Text>
          {logoUrl && !iconError && (
            <CachedImage
              source={logoUrl}
              style={imageStyle}
              onError={() => setIconError(true)}
            />
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#16202e',
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  letter: {
    color: '#ffffff',
    fontWeight: '600',
  },
  image: {
    position: 'absolute',
  },
});

export default AppTile;
