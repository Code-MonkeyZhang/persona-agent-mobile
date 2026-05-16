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
const reasoningExpandedKey = keyPrefix + 'reasoningExpandedKey';
const serverAddressKey = keyPrefix + 'serverAddress';
const serverAgentIdKey = keyPrefix + 'serverAgentId';
const ttsEnabledKey = keyPrefix + 'ttsEnabled';

let currentReasoningExpanded: boolean | undefined;

export function saveHapticEnabled(enabled: boolean) {
  storage.set(hapticEnabledKey, enabled);
}

export function getHapticEnabled() {
  return storage.getBoolean(hapticEnabledKey) ?? true;
}

export function getTextModel(): Model {
  return { modelId: '', modelName: '' };
}

export function saveReasoningExpanded(expanded: boolean) {
  currentReasoningExpanded = expanded;
  storage.set(reasoningExpandedKey, expanded);
}

export function getReasoningExpanded() {
  if (currentReasoningExpanded !== undefined) {
    return currentReasoningExpanded;
  } else {
    currentReasoningExpanded = storage.getBoolean(reasoningExpandedKey) ?? true;
    return currentReasoningExpanded;
  }
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
