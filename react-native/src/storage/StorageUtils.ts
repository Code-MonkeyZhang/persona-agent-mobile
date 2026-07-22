import { MMKV } from 'react-native-mmkv';
import { Model } from '../types/Chat.ts';
import uuid from 'uuid';

export const storage = new MMKV();

const initializeStorage = () => {
  const key = 'encryption_key';
  let encryptionKey = storage.getString(key);
  if (!encryptionKey) {
    encryptionKey = uuid.v4();
    storage.set(key, encryptionKey);
  }

  return new MMKV({
    id: 'persona',
    encryptionKey: encryptionKey,
  });
};
export const encryptStorage = initializeStorage();

const keyPrefix = 'bedrock/';
const hapticEnabledKey = keyPrefix + 'hapticEnabled';
const serverAddressKey = keyPrefix + 'serverAddress';
const serverAgentIdKey = keyPrefix + 'serverAgentId';
const ttsEnabledKey = keyPrefix + 'ttsEnabled';
const companionOpenKey = keyPrefix + 'companionOpen';
const lastConversationKey = keyPrefix + 'lastConversation';
const deviceIdKey = keyPrefix + 'deviceId';
const deviceNameKey = keyPrefix + 'deviceName';

export function saveHapticEnabled(enabled: boolean) {
  storage.set(hapticEnabledKey, enabled);
}

export function getHapticEnabled() {
  return storage.getBoolean(hapticEnabledKey) ?? true;
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

/**
 * 获取设备唯一标识，首次调用时自动生成 UUID v4 并持久化。
 * deviceId 永久不变，用于服务端设备注册和在线检测。
 */
export function getDeviceId(): string {
  let id = storage.getString(deviceIdKey);
  if (!id) {
    id = uuid.v4();
    storage.set(deviceIdKey, id);
  }
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
