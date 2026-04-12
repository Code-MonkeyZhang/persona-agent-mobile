import { MMKV } from 'react-native-mmkv';
import {
  AllModel,
  Chat,
  ChatMode,
  SwiftChatMessage,
  Model,
  OpenAICompatConfig,
  ModelTag,
  Usage,
} from '../types/Chat.ts';
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
    id: 'swiftchat',
    encryptionKey: encryptionKey,
  });
};
export const encryptStorage = initializeStorage();

const keyPrefix = 'bedrock/';
const messageListKey = keyPrefix + 'messageList';
const sessionIdPrefix = keyPrefix + 'sessionId/';
const currentSessionIdKey = keyPrefix + 'currentSessionId';
const hapticEnabledKey = keyPrefix + 'hapticEnabled';
const textModelKey = keyPrefix + 'textModelKey';
const allModelKey = keyPrefix + 'allModelKey';
const reasoningExpandedKey = keyPrefix + 'reasoningExpandedKey';
const modelOrderKey = keyPrefix + 'modelOrderKey';
const openAICompatConfigsKey = keyPrefix + 'openAICompatConfigsKey';
const serverAddressKey = keyPrefix + 'serverAddress';
const serverAgentIdKey = keyPrefix + 'serverAgentId';
const serverSessionMapKey = keyPrefix + 'serverSessionMap';

let currentTextModel: Model | undefined;
let currentReasoningExpanded: boolean | undefined;
let currentModelOrder: Model[] | undefined;
let currentOpenAICompatibleConfig: OpenAICompatConfig[] | undefined;

export function saveMessages(
  sessionId: number,
  messages: SwiftChatMessage[],
  usage: Usage
) {
  messages[0].usage = usage;
  messages.forEach((message, index) => {
    if (index !== 0 && 'usage' in message) {
      delete message.usage;
    }
  });
  storage.set(sessionIdPrefix + sessionId, JSON.stringify(messages));
}

export function saveMessageList(
  sessionId: number,
  fistMessage: SwiftChatMessage,
  chatMode: ChatMode
) {
  let allMessageStr = getMessageListStr();
  const currentMessageStr = JSON.stringify({
    id: sessionId,
    title: fistMessage.text.substring(0, 50).replaceAll('\n', ' '),
    mode: chatMode.toString(),
    timestamp: (fistMessage.createdAt as Date).getTime(),
  });
  if (allMessageStr.length === 1) {
    allMessageStr = currentMessageStr + allMessageStr;
  } else {
    allMessageStr = currentMessageStr + ',' + allMessageStr;
  }
  storage.set(messageListKey, allMessageStr);
  storage.set(currentSessionIdKey, sessionId);
}

export function getMessageList(): Chat[] {
  return JSON.parse('[' + getMessageListStr()) as Chat[];
}

export function updateMessageList(chatList: Chat[]) {
  if (chatList.length > 0) {
    storage.set(messageListKey, JSON.stringify(chatList).substring(1));
  } else {
    storage.delete(messageListKey);
  }
}

function getMessageListStr() {
  return storage.getString(messageListKey) ?? ']';
}

export function getMessagesBySessionId(sessionId: number): SwiftChatMessage[] {
  const messageStr = storage.getString(sessionIdPrefix + sessionId);
  if (messageStr) {
    return JSON.parse(messageStr) as SwiftChatMessage[];
  }
  return [];
}

export function deleteMessagesBySessionId(sessionId: number) {
  storage.delete(sessionIdPrefix + sessionId);
}

export function getSessionId() {
  return storage.getNumber(currentSessionIdKey) ?? 0;
}

export function saveHapticEnabled(enabled: boolean) {
  storage.set(hapticEnabledKey, enabled);
}

export function getHapticEnabled() {
  return storage.getBoolean(hapticEnabledKey) ?? true;
}

export function saveTextModel(model: Model) {
  currentTextModel = model;
  storage.set(textModelKey, JSON.stringify(model));
}

export function getTextModel(): Model {
  if (currentTextModel) {
    return currentTextModel;
  } else {
    const modelString = storage.getString(textModelKey) ?? '';
    if (modelString.length > 0) {
      currentTextModel = JSON.parse(modelString) as Model;
    } else {
      const allModels = getAllModels().textModel;
      currentTextModel =
        allModels.length > 0
          ? allModels[0]
          : ({
              modelId: '',
              modelName: '',
              modelTag: ModelTag.OpenAICompatible,
            } as Model);
    }
    return currentTextModel;
  }
}

export function saveAllModels(allModels: AllModel) {
  storage.set(allModelKey, JSON.stringify(allModels));
}

export function getAllModels() {
  const modelString = storage.getString(allModelKey) ?? '';
  if (modelString.length > 0) {
    return JSON.parse(modelString) as AllModel;
  }
  return {
    textModel: [],
  };
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

export function saveModelOrder(models: Model[]) {
  currentModelOrder = models;
  storage.set(modelOrderKey, JSON.stringify(models));
}

export function getModelOrder(): Model[] {
  if (currentModelOrder) {
    return currentModelOrder;
  } else {
    const modelOrderString = storage.getString(modelOrderKey) ?? '';
    if (modelOrderString.length > 0) {
      currentModelOrder = JSON.parse(modelOrderString) as Model[];
    } else {
      currentModelOrder = [];
    }
    return currentModelOrder;
  }
}

export function updateTextModelUsageOrder(model: Model) {
  const currentOrder = getModelOrder();
  const updatedOrder = [
    model,
    ...currentOrder.filter(m => m.modelId !== model.modelId),
  ];
  saveModelOrder(updatedOrder);
  return updatedOrder;
}

export function getMergedModelOrder(): Model[] {
  const historyModels = getModelOrder();
  const currentTextModels = getAllModels().textModel;
  const currentModelMap = new Map<string, Model>();
  currentTextModels.forEach(model => {
    currentModelMap.set(model.modelId, model);
  });
  const mergedModels: Model[] = [];
  historyModels.forEach(model => {
    if (currentModelMap.has(model.modelId)) {
      mergedModels.push(currentModelMap.get(model.modelId)!);
      currentModelMap.delete(model.modelId);
    }
  });
  currentModelMap.forEach(model => {
    mergedModels.push(model);
  });

  return mergedModels;
}

export function saveOpenAICompatConfigs(configs: OpenAICompatConfig[]) {
  currentOpenAICompatibleConfig = configs;
  encryptStorage.set(openAICompatConfigsKey, JSON.stringify(configs));
}

export function getOpenAICompatConfigs(): OpenAICompatConfig[] {
  if (currentOpenAICompatibleConfig) {
    return currentOpenAICompatibleConfig;
  } else {
    const configsStr = encryptStorage.getString(openAICompatConfigsKey);
    if (configsStr) {
      currentOpenAICompatibleConfig = JSON.parse(
        configsStr
      ) as OpenAICompatConfig[];
      return currentOpenAICompatibleConfig;
    }
    return [];
  }
}

export function extractDomainFromUrl(url: string): string {
  if (!url) {
    return '';
  }
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const parts = hostname.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 2];
    }
    return parts[0];
  } catch {
    return '';
  }
}

export function clearAllChatHistory(): void {
  const chatList = getMessageList();
  chatList.forEach(chat => {
    storage.delete(sessionIdPrefix + chat.id);
  });

  storage.delete(messageListKey);
  storage.delete(currentSessionIdKey);
}

/** 保存 nano-agent 服务器地址 */
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

/**
 * 保存本地会话 ID 到服务器会话 UUID 的映射。
 * @param localId 本地数字会话 ID
 * @param serverId 服务器端会话 UUID
 */
export function saveServerSessionId(localId: number, serverId: string) {
  const map = getServerSessionMap();
  map[localId.toString()] = serverId;
  storage.set(serverSessionMapKey, JSON.stringify(map));
}

/** 查找本地会话对应的服务器会话 UUID，不存在则返回 undefined */
export function getServerSessionId(localId: number): string | undefined {
  const map = getServerSessionMap();
  return map[localId.toString()];
}

/** 删除指定本地会话的服务器会话映射 */
export function deleteServerSessionId(localId: number) {
  const map = getServerSessionMap();
  delete map[localId.toString()];
  storage.set(serverSessionMapKey, JSON.stringify(map));
}

/** 清空所有本地到服务器的会话映射 */
export function clearServerSessionMap() {
  storage.delete(serverSessionMapKey);
}

/** 内部：从 MMKV 加载完整的本地-服务器会话映射表 */
function getServerSessionMap(): Record<string, string> {
  const str = storage.getString(serverSessionMapKey);
  if (str) {
    return JSON.parse(str) as Record<string, string>;
  }
  return {};
}

export function generateOpenAICompatModels(
  configs: OpenAICompatConfig[]
): Model[] {
  const openAICompatModelList: Model[] = [];

  configs.forEach(config => {
    if (config.modelIds && config.modelIds.length > 0 && config.baseUrl) {
      const domain = extractDomainFromUrl(config.baseUrl);
      const prefix = domain ? `${domain}/` : '';

      const models = config.modelIds.split(',').map(modelId => {
        modelId = modelId.trim().replace(/(\r\n|\n|\r)/gm, '');
        const parts = modelId.split('/');
        const displayName =
          prefix + (parts.length === 2 ? parts[1] : modelId).trim();

        return {
          modelId: modelId,
          modelName: displayName,
          modelTag: ModelTag.OpenAICompatible,
          uniqueId: config.id,
          apiKey: config.apiKey ?? '',
          apiUrl: config.baseUrl ?? '',
        } as Model;
      });
      openAICompatModelList.push(...models);
    }
  });

  return openAICompatModelList;
}
