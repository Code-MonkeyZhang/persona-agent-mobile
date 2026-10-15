/**
 * @file PhoneWallpaper.tsx
 * @description 壁纸层组件，自定义图整层铺 cover，预设渲染成全屏 SVG 底图。
 *   viewBox 定为 100x200 配 preserveAspectRatio none，拉伸铺满任意屏幕比例，
 *   预设未命中时由调用方回落默认底。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import CachedImage from '../../component/CachedImage';
import { type WallpaperPreset } from '../../data/wallpaperPresets';
import { ColorScheme, useTheme } from '../../theme/index.ts';

/**
 * 把 CSS 语义的渐变角度换算成 SVG 渐变端点。
 * CSS 角度 0 度指向上、顺时针增长，换算成过中心的方向向量端点。
 */
function angleToPoints(angle: number) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return {
    x1: 0.5 - dx / 2,
    y1: 0.5 - dy / 2,
    x2: 0.5 + dx / 2,
    y2: 0.5 + dy / 2,
  };
}

const PhoneWallpaper: React.FC<{
  preset: WallpaperPreset;
  imageUrl?: string | null;
}> = ({ preset, imageUrl }) => {
  if (imageUrl) {
    return <CachedImage source={imageUrl} style={styles.fill} />;
  }
  const glows = preset.glows ?? [];
  const { x1, y1, x2, y2 } = angleToPoints(preset.base.angle);
  return (
    <Svg style={styles.fill} viewBox="0 0 100 200" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="wpBase" x1={x1} y1={y1} x2={x2} y2={y2}>
          {preset.base.stops.map((s) => (
            <Stop
              key={s.offset}
              offset={s.offset}
              stopColor={s.color}
              stopOpacity={s.opacity ?? 1}
            />
          ))}
        </LinearGradient>
        {glows.map((g, i) => (
          <RadialGradient
            key={i}
            id={`wpGlow${i}`}
            cx={g.cx}
            cy={g.cy}
            rx={g.rx}
            ry={g.ry}
          >
            <Stop offset={0} stopColor={g.color} stopOpacity={g.opacity} />
            <Stop offset={g.fade} stopColor={g.color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      <Rect x={0} y={0} width={100} height={200} fill="url(#wpBase)" />
      {glows.map((g, i) => (
        <Rect
          key={i}
          x={0}
          y={0}
          width={100}
          height={200}
          fill={`url(#wpGlow${i})`}
        />
      ))}
      {(preset.dots ?? []).map((d, i) => (
        <Circle
          key={i}
          cx={d.x}
          cy={(d.y / 100) * 200}
          r={d.r}
          fill="#ffffff"
          opacity={d.opacity ?? 0.95}
        />
      ))}
    </Svg>
  );
};

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
});

/** 固定尺寸的壁纸缩略预览，壁纸页的预设块与设置页的行尾共用 */
export const WallpaperSwatch: React.FC<{
  width: number;
  height: number;
  radius: number;
  preset: WallpaperPreset;
  imageUrl?: string | null;
  selected?: boolean;
}> = ({ width, height, radius, preset, imageUrl, selected }) => {
  const { colors } = useTheme();
  const swatch = createSwatchStyles(colors);
  return (
    <View
      style={[
        swatch.box,
        swatch.dimmable,
        { width, height, borderRadius: radius },
        selected && swatch.selected,
      ]}
    >
      <PhoneWallpaper preset={preset} imageUrl={imageUrl} />
    </View>
  );
};

const createSwatchStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    box: {
      overflow: 'hidden',
    },
    dimmable: {
      borderWidth: 2,
      borderColor: 'transparent',
    },
    selected: {
      borderColor: colors.primary,
    },
  });

export default PhoneWallpaper;
