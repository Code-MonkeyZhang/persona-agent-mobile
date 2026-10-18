/**
 * @file stores/settingsStore.ts
 * @description 显示偏好仓库：跨页面的 UI 偏好收敛于此。
 *   思考过程开关由设置页写入、消息行订阅。聊天页在导航栈内常驻，
 *   消息行又被 memo 比较器保护，只有组件内的 store 订阅能穿过 memo 触发重渲染。
 */
import { create } from 'zustand';
import {
  getShowThoughtProcess,
  saveShowThoughtProcess,
} from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';

interface SettingsStore {
  /** 聊天消息里「查看思考过程」入口是否显示 */
  thoughtProcessVisible: boolean;
  setThoughtProcessVisible: (visible: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()((set) => ({
  thoughtProcessVisible: getShowThoughtProcess(),

  setThoughtProcessVisible: (visible) => {
    logger.info(`[Settings] thought process visibility: ${visible}`);
    saveShowThoughtProcess(visible);
    set({ thoughtProcessVisible: visible });
  },
}));
