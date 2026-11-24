/**
 * @file stores/settingsStore.ts
 * @description 显示偏好仓库：跨页面的 UI 偏好收敛于此。
 *   思考过程开关由设置页写入、消息行订阅。聊天页在导航栈内常驻，
 *   消息行又被 memo 比较器保护，只有组件内的 store 订阅能穿过 memo 触发重渲染。
 *   呼吸动画与思考气泡两个开关同理，由设置页写入、陪伴舞台订阅，按设备本地存不进服务端。
 */
import { create } from 'zustand';
import {
  getBreathAnimation,
  getShowThoughtProcess,
  getThinkingBubble,
  saveBreathAnimation,
  saveShowThoughtProcess,
  saveThinkingBubble,
} from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';

interface SettingsStore {
  /** 聊天消息里「查看思考过程」入口是否显示 */
  thoughtProcessVisible: boolean;
  /** 陪伴立绘的呼吸动画是否开启，关闭后立绘完全静止 */
  breathEnabled: boolean;
  /** 生成期间头顶的思考气泡是否开启，关闭后情绪气泡不受影响 */
  thinkingBubbleEnabled: boolean;
  setThoughtProcessVisible: (visible: boolean) => void;
  setBreathEnabled: (enabled: boolean) => void;
  setThinkingBubbleEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()((set) => ({
  thoughtProcessVisible: getShowThoughtProcess(),
  breathEnabled: getBreathAnimation(),
  thinkingBubbleEnabled: getThinkingBubble(),

  setThoughtProcessVisible: (visible) => {
    logger.info(`[Settings] thought process visibility: ${visible}`);
    saveShowThoughtProcess(visible);
    set({ thoughtProcessVisible: visible });
  },

  setBreathEnabled: (enabled) => {
    logger.info(`[Settings] breath animation: ${enabled}`);
    saveBreathAnimation(enabled);
    set({ breathEnabled: enabled });
  },

  setThinkingBubbleEnabled: (enabled) => {
    logger.info(`[Settings] thinking bubble: ${enabled}`);
    saveThinkingBubble(enabled);
    set({ thinkingBubbleEnabled: enabled });
  },
}));
