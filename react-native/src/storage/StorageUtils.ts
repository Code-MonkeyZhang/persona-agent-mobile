import { MMKV } from 'react-native-mmkv';
import { Model } from '../types/Chat.ts';
import { v4 as uuidv4 } from 'uuid';
import type { PoseAssets } from '../api/server-api.ts';
import { logger } from '../lib/logger';

export const storage = new MMKV();

const keyPrefix = 'bedrock/';
const hapticEnabledKey = keyPrefix + 'hapticEnabled';
const showThoughtProcessKey = keyPrefix + 'showThoughtProcess';
const serverAddressKey = keyPrefix + 'serverAddress';
const serverAgentIdKey = keyPrefix + 'serverAgentId';
const ttsEnabledKey = keyPrefix + 'ttsEnabled';
const companionOpenKey = keyPrefix + 'companionOpen';
const stripCollapsedKey = keyPrefix + 'stripCollapsed';
const lastConversationKey = keyPrefix + 'lastConversation';
const deviceIdKey = keyPrefix + 'deviceId';
const deviceNameKey = keyPrefix + 'deviceName';
const devicesKey = keyPrefix + 'devices';
const posesAssetsPrefix = keyPrefix + 'posesAssets/';

export function saveHapticEnabled(enabled: boolean) {
  storage.set(hapticEnabledKey, enabled);
}

export function getHapticEnabled() {
  return storage.getBoolean(hapticEnabledKey) ?? true;
}

/** 保存思考过程入口显示开关 */
export function saveShowThoughtProcess(enabled: boolean) {
  storage.set(showThoughtProcessKey, enabled);
}

/** 获取思考过程入口显示开关，未设置时默认显示 */
export function getShowThoughtProcess() {
  return storage.getBoolean(showThoughtProcessKey) ?? true;
}

export function getTextModel(): Model {
  return { modelId: '', modelName: '' };
}

/** 保存 Agent Server 地址 */
export function saveServerAddress(address: string) {
  storage.set(serverAddressKey, address);
}

/** 获取保存的服务器地址，未设置时返回空字符串 */
export function getServerAddress(): string {
  return storage.getString(serverAddressKey) ?? '';
}

/** 保存选中的 agent ID，避免每次重新获取 */
export function saveServerAgentId(agentId: string) {
  storage.set(serverAgentIdKey, agentId);
}

/** 获取保存的 agent ID，未设置时返回空字符串 */
export function getServerAgentId(): string {
  return storage.getString(serverAgentIdKey) ?? '';
}

/** 保存 TTS 语音开关状态 */
export function saveTtsEnabled(enabled: boolean) {
  storage.set(ttsEnabledKey, enabled);
}

/** 获取 TTS 语音开关状态 */
export function getTtsEnabled(): boolean {
  return storage.getBoolean(ttsEnabledKey) ?? false;
}

/** 保存陪伴面板是否展开 */
export function saveCompanionOpen(open: boolean) {
  storage.set(companionOpenKey, open);
}

/** 获取陪伴面板是否展开，默认 false */
export function getCompanionOpen(): boolean {
  return storage.getBoolean(companionOpenKey) ?? false;
}

/** 保存时间线收起档偏好，true 为发丝线档，line 与 hair 切换时写入，open 不记录 */
export function saveStripCollapsed(collapsed: boolean) {
  storage.set(stripCollapsedKey, collapsed);
}

/** 获取时间线收起档偏好，默认 false 即留一行档 */
export function getStripCollapsed(): boolean {
  return storage.getBoolean(stripCollapsedKey) ?? false;
}

/** 上次打开的对话，Agent 与会话成对存储，用于冷启动恢复 */
export interface LastConversation {
  agentId: string;
  sessionId: string;
}

/**
 * 保存上次的 Agent 与会话，两者成对写入，保证恢复时取到的是匹配的一对。
 */
export function saveLastConversation(agentId: string, sessionId: string) {
  const value = JSON.stringify({ agentId, sessionId });
  storage.set(lastConversationKey, value);
}

/**
 * 读取上次的 Agent 与会话，未设置时返回 null。
 */
export function getLastConversation(): LastConversation | null {
  const raw = storage.getString(lastConversationKey);
  if (raw) {
    try {
      return JSON.parse(raw) as LastConversation;
    } catch {
      return null;
    }
  }
  return null;
}

/** 清掉上次会话恢复对，切换主机后旧主机的会话身份不再恢复 */
export function clearLastConversation(): void {
  storage.delete(lastConversationKey);
}

/** 手机端记住的主机条目，hostId 是身份，地址是属性 */
export interface DeviceEntry {
  hostId: string;
  /** 本地标签，建档时取握手自称名作初始值，此后归用户所有 */
  name: string;
  /** 最近一次成功连接的地址 */
  address: string;
  /** 服务端版本号，握手成功时刷新，空串表示还没握过手 */
  version: string;
  /** 最近一次成功连接的毫秒时间戳 */
  lastConnectedAt: number;
}

/** 设备登记表，currentHostId 为空串表示一台主机都没有 */
export interface DeviceRegistry {
  currentHostId: string;
  devices: DeviceEntry[];
}

/**
 * 读取设备登记表，缺失或损坏时自愈回空表，重新扫码即恢复。
 * 旧模型的 hostName 字段读入时归一，空名条目抄作本地标签初始值后删除该字段。
 */
export function loadDeviceRegistry(): DeviceRegistry {
  const raw = storage.getString(devicesKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DeviceRegistry;
      if (
        Array.isArray(parsed.devices) &&
        typeof parsed.currentHostId === 'string'
      ) {
        normalizeLegacyEntries(parsed.devices);
        return parsed;
      }
    } catch {
      logger.warn('[Storage] device registry corrupted, resetting');
    }
  }
  return { currentHostId: '', devices: [] };
}

/** 旧模型的 hostName 字段一次性归一，空名抄作标签初始值，缺版本补空串，幂等可重跑 */
function normalizeLegacyEntries(devices: DeviceEntry[]): void {
  let migrated = 0;
  for (const device of devices as Array<
    DeviceEntry & { hostName?: string; version?: string }
  >) {
    if ('hostName' in device) {
      if (!device.name && device.hostName) {
        device.name = device.hostName;
      }
      delete device.hostName;
      migrated += 1;
    }
    device.version ??= '';
  }
  if (migrated > 0) {
    logger.info(
      `[Storage] migrated ${migrated} device entries to the local-label model`
    );
  }
}

/** 整体写回设备登记表 */
export function saveDeviceRegistry(registry: DeviceRegistry): void {
  storage.set(devicesKey, JSON.stringify(registry));
}

/**
 * 获取设备唯一标识，首次调用时自动生成 UUID v4 并持久化。
 * deviceId 永久不变，用于服务端设备注册和在线检测。
 */
export function getDeviceId(): string {
  const existing = storage.getString(deviceIdKey);
  if (existing) {
    return existing;
  }
  const id = uuidv4();
  storage.set(deviceIdKey, id);
  return id;
}

/** 保存设备名到 MMKV */
export function saveDeviceName(name: string) {
  storage.set(deviceNameKey, name);
}

/** 获取缓存的设备名，未设置时返回空字符串 */
export function getSavedDeviceName(): string {
  return storage.getString(deviceNameKey) ?? '';
}

/** 保存指定 agent 的立绘与背景清单，断网时地址数据从这读 */
export function savePosesAssets(agentId: string, assets: PoseAssets) {
  storage.set(posesAssetsPrefix + agentId, JSON.stringify(assets));
}

/** 读取指定 agent 的立绘与背景清单，未设置或损坏时返回 null */
export function getPosesAssets(agentId: string): PoseAssets | null {
  const raw = storage.getString(posesAssetsPrefix + agentId);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PoseAssets;
  } catch {
    return null;
  }
}
