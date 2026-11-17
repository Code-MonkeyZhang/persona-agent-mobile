/**
 * @file builtInTools.ts — 内置条目的图标映射，条目与功能数据本体来自 /api/tools 注册表
 * 移动端仓不依赖 @persona/shared，built_in 前缀 id 以字面量对齐服务端清单，
 * 图标是纯展示层，记忆统一书本带心，未登记 id 走扳手兜底
 */
import {
  Terminal,
  FileText,
  Globe,
  BookHeart,
  Smile,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';

/** 内置条目 id 到图标的映射，id 与服务端 BUILTIN_TOOLSET_IDS 同值 */
export const BUILTIN_ICONS: Record<string, LucideIcon> = {
  built_in_terminal: Terminal,
  built_in_files: FileText,
  built_in_web: Globe,
  built_in_pose: Smile,
  built_in_memory: BookHeart,
};

/** 未登记内置 id 的兜底图标 */
export const BUILTIN_ICON_FALLBACK: LucideIcon = Wrench;
