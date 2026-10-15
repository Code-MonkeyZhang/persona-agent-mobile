/**
 * @file data/wallpaperPresets.ts
 * @description 小手机壁纸预设与文档解析。预设与桌面端同 id 同名同深浅标记，
 *   桌面端用 CSS 多层渐变表达，移动端没有 CSS 渐变，改用 SVG 可描述的
 *   底层线性渐变加径向光斑加圆点三层结构表达同一画面，母本为桌面端新版渐变。
 */
import type { WallpaperDoc } from '../storage/sync-shapes.ts';

/** 线性渐变的一个色阶 */
export interface GradientStop {
  /** 0 到 1 的位置 */
  offset: number;
  color: string;
  opacity?: number;
}

/** 底层线性渐变，angle 沿用 CSS 语义，0 度指向上 */
export interface LinearGradientSpec {
  angle: number;
  stops: GradientStop[];
}

/** 叠在底色上的径向光斑，cx cy rx ry 都是宽或高的比例 */
export interface RadialGlow {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: string;
  opacity: number;
  /** 从这个位置淡出到全透明 */
  fade: number;
}

/** 星点类小圆，x y 为宽高的百分比坐标 */
export interface WallpaperDot {
  x: number;
  y: number;
  r: number;
  opacity?: number;
}

/** 壁纸预设条目 */
export interface WallpaperPreset {
  id: string;
  /** 展示名 i18n 键 */
  nameKey: string;
  /** 深色壁纸为 true，桌面文字走白色 */
  dark: boolean;
  base: LinearGradientSpec;
  glows?: RadialGlow[];
  dots?: WallpaperDot[];
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'dawn',
    nameKey: 'wallpaper.dawn',
    dark: false,
    base: {
      angle: 180,
      stops: [
        { offset: 0, color: '#c7d4ea' },
        { offset: 0.42, color: '#e6d8e4' },
        { offset: 0.74, color: '#f9e4cf' },
        { offset: 1, color: '#fde8cd' },
      ],
    },
    glows: [
      {
        cx: 0.5,
        cy: 1,
        rx: 0.85,
        ry: 0.28,
        color: '#ffc48c',
        opacity: 0.55,
        fade: 0.7,
      },
      {
        cx: 0.2,
        cy: 0,
        rx: 0.95,
        ry: 0.5,
        color: '#d6e2f7',
        opacity: 0.5,
        fade: 0.65,
      },
    ],
  },
  {
    id: 'coast',
    nameKey: 'wallpaper.coast',
    dark: false,
    base: {
      angle: 180,
      stops: [
        { offset: 0, color: '#a9d3ee' },
        { offset: 0.38, color: '#cde9ff' },
        { offset: 0.58, color: '#e8f6fc' },
        { offset: 1, color: '#f4ecd9' },
      ],
    },
    glows: [
      {
        cx: 0.78,
        cy: 0.16,
        rx: 0.85,
        ry: 0.28,
        color: '#fff4d6',
        opacity: 0.75,
        fade: 0.7,
      },
      {
        cx: 0.5,
        cy: 0.62,
        rx: 1,
        ry: 0.15,
        color: '#ffffff',
        opacity: 0.28,
        fade: 0.75,
      },
    ],
  },
  {
    id: 'lavender',
    nameKey: 'wallpaper.lavender',
    dark: false,
    base: {
      angle: 165,
      stops: [
        { offset: 0, color: '#f6efff' },
        { offset: 0.48, color: '#ead9f8' },
        { offset: 0.78, color: '#e0cdf2' },
        { offset: 1, color: '#d9c6f0' },
      ],
    },
    glows: [
      {
        cx: 0.8,
        cy: 0,
        rx: 1,
        ry: 0.38,
        color: '#f4d0ff',
        opacity: 0.6,
        fade: 0.68,
      },
      {
        cx: 0.12,
        cy: 0.88,
        rx: 0.95,
        ry: 0.34,
        color: '#c4b5fd',
        opacity: 0.5,
        fade: 0.7,
      },
    ],
  },
  {
    id: 'sunset',
    nameKey: 'wallpaper.sunset',
    dark: true,
    base: {
      angle: 190,
      stops: [
        { offset: 0, color: '#140f2e' },
        { offset: 0.34, color: '#3b2264' },
        { offset: 0.58, color: '#8f3e63' },
        { offset: 0.8, color: '#e8734a' },
        { offset: 1, color: '#ffb26b' },
      ],
    },
    glows: [
      {
        cx: 0.5,
        cy: 0.66,
        rx: 0.2,
        ry: 0.1,
        color: '#ffd68c',
        opacity: 0.9,
        fade: 0.6,
      },
      {
        cx: 0.5,
        cy: 0.7,
        rx: 0.8,
        ry: 0.28,
        color: '#ff9e57',
        opacity: 0.55,
        fade: 0.72,
      },
    ],
  },
  {
    id: 'night',
    nameKey: 'wallpaper.night',
    dark: true,
    base: {
      angle: 178,
      stops: [
        { offset: 0, color: '#070b1d' },
        { offset: 0.55, color: '#101638' },
        { offset: 1, color: '#1b1f4b' },
      ],
    },
    glows: [
      {
        cx: 0.79,
        cy: 0.14,
        rx: 0.08,
        ry: 0.032,
        color: '#f0f4ff',
        opacity: 0.95,
        fade: 0.62,
      },
      {
        cx: 0.7,
        cy: 0.2,
        rx: 1,
        ry: 0.5,
        color: '#6366f1',
        opacity: 0.16,
        fade: 0.7,
      },
    ],
    dots: [
      { x: 22, y: 28, r: 0.45 },
      { x: 64, y: 18, r: 0.3 },
      { x: 82, y: 42, r: 0.45 },
      { x: 38, y: 52, r: 0.3 },
      { x: 55, y: 68, r: 0.3 },
      { x: 30, y: 10, r: 0.3 },
      { x: 70, y: 56, r: 0.45 },
      { x: 12, y: 44, r: 0.3 },
      { x: 88, y: 74, r: 0.3 },
    ],
  },
];

/** 未设壁纸时的默认底，与桌面端默认底的画面一致 */
export const DEFAULT_WALLPAPER: WallpaperPreset = {
  id: 'default',
  nameKey: 'wallpaper.default',
  dark: false,
  base: {
    angle: 168,
    stops: [
      { offset: 0, color: '#e9f1fa' },
      { offset: 0.5, color: '#f3f6fb' },
      { offset: 1, color: '#eef1f6' },
    ],
  },
  glows: [
    {
      cx: 0.88,
      cy: -0.04,
      rx: 0.9,
      ry: 0.35,
      color: '#228be6',
      opacity: 0.1,
      fade: 0.6,
    },
    {
      cx: -0.04,
      cy: 1.04,
      rx: 0.85,
      ry: 0.35,
      color: '#8b5cf6',
      opacity: 0.07,
      fade: 0.6,
    },
  ],
};

/** 壁纸文档的解析结果，预设与自定义图互斥，都未命中走默认底 */
export interface ResolvedWallpaper {
  preset: WallpaperPreset | null;
  /** 自定义图按内容哈希拼出的绝对地址 */
  imageUrl: string | null;
  dark: boolean;
  /** 预设命中的展示名 i18n 键，自定义为 null */
  nameKey: string | null;
  /** 自定义命中的条目名，条目未命名或未命中为 undefined */
  customName: string | undefined;
}

/**
 * 把壁纸文档解析成层可消费的渲染来源。
 * currentId 命中预设取预设，命中自定义按哈希拼下载地址，
 * null 或条目已丢时按未设置处理走默认底，展示名随分支一并带出。
 * 文件地址由调用方注入，数据层不依赖 server-api。
 */
export function resolveWallpaper(
  doc: WallpaperDoc | null,
  getFileUrl: (hash: string) => string
): ResolvedWallpaper {
  if (!doc?.currentId) {
    return {
      preset: null,
      imageUrl: null,
      dark: false,
      nameKey: null,
      customName: undefined,
    };
  }
  const preset = WALLPAPER_PRESETS.find((p) => p.id === doc.currentId);
  if (preset) {
    return {
      preset,
      imageUrl: null,
      dark: preset.dark,
      nameKey: preset.nameKey,
      customName: undefined,
    };
  }
  const custom = doc.customs.find((c) => c.id === doc.currentId);
  if (custom) {
    return {
      preset: null,
      imageUrl: getFileUrl(custom.hash),
      dark: custom.dark,
      nameKey: null,
      customName: custom.name,
    };
  }
  return {
    preset: null,
    imageUrl: null,
    dark: false,
    nameKey: null,
    customName: undefined,
  };
}
