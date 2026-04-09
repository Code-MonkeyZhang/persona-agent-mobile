import {
  AllModel,
  BedrockChunk,
  ChatMode,
  Model,
  ModelTag,
  SystemPrompt,
  TokenResponse,
  Usage,
} from '../types/Chat.ts';
import {
  getApiKey,
  getApiUrl,
  getBedrockApiKey,
  getBedrockConfigMode,
  getDeepSeekApiKey,
  getOpenAIApiKey,
  getRegion,
  getTextModel,
  getThinkingEnabled,
  saveTokenInfo,
} from '../storage/StorageUtils.ts';
import { BedrockMessage } from '../chat/util/BedrockMessageConvertor.ts';
import { invokeOpenAIWithCallBack } from './open-api.ts';
import { invokeOllamaWithCallBack } from './ollama-api.ts';
import { BedrockThinkingModels } from '../storage/Constants.ts';
import { getModelTag } from '../utils/ModelUtils.ts';
import { invokeBedrockWithAPIKey, sleep } from './bedrock-api-key.ts';

type CallbackFunction = (
  result: string,
  complete: boolean,
  needStop: boolean,
  usage?: Usage,
  reasoning?: string
) => void;
export const isDev = false;
export const invokeBedrockWithCallBack = async (
  messages: BedrockMessage[],
  chatMode: ChatMode,
  prompt: SystemPrompt | null,
  shouldStop: () => boolean,
  controller: AbortController,
  callback: CallbackFunction
) => {
  const currentModelTag = getModelTag(getTextModel());
  if (currentModelTag !== ModelTag.Bedrock) {
    if (
      currentModelTag === ModelTag.DeepSeek &&
      getDeepSeekApiKey().length === 0
    ) {
      callback('Please configure your DeepSeek API Key', true, false);
      return;
    }
    if (currentModelTag === ModelTag.OpenAI && getOpenAIApiKey().length === 0) {
      callback('Please configure your OpenAI API Key', true, false);
      return;
    }
    if (
      currentModelTag === ModelTag.OpenAICompatible &&
      getTextModel().apiUrl!.length === 0
    ) {
      callback('Please configure your OpenAI Compatible API URL', true, false);
      return;
    }
    if (currentModelTag === ModelTag.Ollama) {
      await invokeOllamaWithCallBack(
        messages,
        prompt,
        shouldStop,
        controller,
        callback
      );
    } else {
      await invokeOpenAIWithCallBack(
        messages,
        prompt,
        shouldStop,
        controller,
        callback
      );
    }
    return;
  }
  const bedrockConfigMode = getBedrockConfigMode();
  const bedrockApiKey = getBedrockApiKey();
  if (bedrockConfigMode === 'bedrock' && !bedrockApiKey) {
    callback('Please configure your Bedrock API Key', true, false);
    return;
  }
  if (bedrockConfigMode === 'bedrock') {
    await invokeBedrockWithAPIKey(
      messages,
      prompt,
      shouldStop,
      controller,
      callback
    );
    return;
  }
  if (!isConfigured()) {
    callback(
      'Please configure your SwiftChat Server API URL and API Key',
      true,
      false
    );
    return;
  }
  const bodyObject = {
    messages: messages,
    modelId: getTextModel().modelId,
    region: getRegion(),
    enableThinking: isEnableThinking(),
    system: prompt ? [{ text: prompt?.prompt }] : undefined,
  };
  if (prompt?.includeHistory === false) {
    bodyObject.messages = messages.slice(-1);
  }

  const options = {
    method: 'POST',
    headers: getAuthHeaders('application/json'),
    body: JSON.stringify(bodyObject),
    signal: controller.signal,
    reactNative: { textStreaming: true },
  };
  const url = getApiPrefix() + '/converse/v3';
  let completeMessage = '';
  let completeReasoning = '';
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  fetch(url!, options)
    .then(response => {
      return response.body;
    })
    .then(async body => {
      clearTimeout(timeoutId);
      if (!body) {
        return;
      }
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let appendTimes = 0;
      while (true) {
        if (shouldStop()) {
          await reader.cancel();
          if (completeMessage === '') {
            completeMessage = '...';
          }
          callback(completeMessage, true, true, undefined, completeReasoning);
          return;
        }

        try {
          const { done, value } = await reader.read();
          const chunk = decoder.decode(value, { stream: true });
          if (chunk.length > 0) {
            const events = chunk.split('\n\n');
            for (const event of events) {
              await sleep(0.1);
              const bedrockChunk = parseChunk(event);
              if (bedrockChunk) {
                if (bedrockChunk.reasoning) {
                  completeReasoning += bedrockChunk.reasoning ?? '';
                  callback(
                    completeMessage,
                    false,
                    false,
                    undefined,
                    completeReasoning
                  );
                }
                if (bedrockChunk.text) {
                  completeMessage += bedrockChunk.text ?? '';
                  appendTimes++;
                  if (appendTimes > 5000 && appendTimes % 2 === 0) {
                    continue;
                  }
                  callback(
                    completeMessage,
                    false,
                    false,
                    undefined,
                    completeReasoning
                  );
                }
                if (bedrockChunk.usage) {
                  bedrockChunk.usage.modelName = getTextModel().modelName;
                  callback(
                    completeMessage,
                    false,
                    false,
                    bedrockChunk.usage,
                    completeReasoning
                  );
                }
              }
            }
          }
          if (done) {
            callback(
              completeMessage,
              true,
              false,
              undefined,
              completeReasoning
            );
            return;
          }
        } catch (readError) {
          console.log('Error reading stream:', readError);
          if (completeMessage === '') {
            completeMessage = '...';
          }
          callback(completeMessage, true, true, undefined, completeReasoning);
          return;
        }
      }
    })
    .catch(error => {
      clearTimeout(timeoutId);
      if (shouldStop()) {
        if (completeMessage === '') {
          completeMessage = '...';
        }
        callback(completeMessage, true, true, undefined, completeReasoning);
      } else {
        let errorMsg = String(error);
        if (errorMsg.endsWith('AbortError: Aborted')) {
          errorMsg = 'Timed out';
        }
        if (errorMsg.indexOf('http') >= 0) {
          errorMsg = 'Unable to resolve host';
        }
        const errorInfo = 'Request error: ' + errorMsg;
        callback(completeMessage + '\n\n' + errorInfo, true, true);
        console.log(errorInfo);
      }
    });
};

export const requestAllModels = async (): Promise<AllModel> => {
  if (getApiUrl() === '') {
    return { textModel: [] };
  }
  const controller = new AbortController();
  const url = getApiPrefix() + '/models';
  const bodyObject = {
    region: getRegion(),
  };
  const options = {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(bodyObject),
    reactNative: { textStreaming: true },
  };
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.log(`HTTP error! status: ${response.status}`);
      return { textModel: [] };
    }
    const allModel = await response.json();
    allModel.textModel = allModel.textModel.map((item: Model) => ({
      modelId: item.modelId,
      modelName: item.modelName,
      modelTag: ModelTag.Bedrock,
    }));
    return allModel;
  } catch (error) {
    console.log('SwiftChat Server Error fetching models:', error);
    clearTimeout(timeoutId);
    return { textModel: [] };
  }
};

export const requestToken = async (): Promise<TokenResponse | null> => {
  if (getApiUrl() === '') {
    return null;
  }

  const url = getApiPrefix() + '/token';
  const bodyObject = {
    region: getRegion(),
  };

  const options = {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(bodyObject),
    reactNative: { textStreaming: true },
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      console.log(`HTTP error! status: ${response.status}`);
      return null;
    }

    const tokenResponse = (await response.json()) as TokenResponse;
    saveTokenInfo(tokenResponse);
    return tokenResponse;
  } catch (error) {
    console.log('Error fetching token:', error);
    return null;
  }
};

function parseChunk(part: string) {
  if (part.length > 0) {
    let combinedReasoning = '';
    let combinedText = '';
    let lastUsage;
    try {
      const chunk: BedrockChunk = JSON.parse(part);
      const content = extractChunkContent(chunk, part);
      if (content.reasoning) {
        combinedReasoning += content.reasoning;
      }
      if (content.text) {
        combinedText += content.text;
      }
      if (content.usage) {
        lastUsage = content.usage;
      }
    } catch (innerError) {
      console.log('DataChunk parse error:', innerError, part);
      return {
        reasoning: combinedReasoning,
        text: part,
        usage: lastUsage,
      };
    }
    return {
      reasoning: combinedReasoning,
      text: combinedText,
      usage: lastUsage,
    };
  }
  return null;
}

/**
 * Helper function to extract content from a BedrockChunk
 */
function extractChunkContent(bedrockChunk: BedrockChunk, rawChunk: string) {
  const reasoning =
    bedrockChunk?.contentBlockDelta?.delta?.reasoningContent?.text;
  let text = bedrockChunk?.contentBlockDelta?.delta?.text;
  const usage = bedrockChunk?.metadata?.usage;
  if (bedrockChunk?.detail) {
    text = rawChunk;
  }
  return { reasoning, text, usage };
}

function getApiPrefix(): string {
  if (isDev) {
    return 'http://localhost:8080/api';
  } else {
    return getApiUrl() + '/api';
  }
}

function getAuthHeaders(
  contentType: string = 'application/json'
): Record<string, string> {
  const apiUrl = getApiUrl();
  const isApiGateway =
    apiUrl.includes('.execute-api.') && apiUrl.includes('.amazonaws.com');
  const headers: Record<string, string> = {
    accept: contentType === 'application/json' ? 'application/json' : '*/*',
    'content-type': contentType,
  };
  if (isApiGateway) {
    headers['x-api-key'] = getApiKey();
  } else {
    headers.Authorization = 'Bearer ' + getApiKey();
  }
  return headers;
}

export const isEnableThinking = (): boolean => {
  return isThinkingModel() && getThinkingEnabled();
};

const isThinkingModel = (): boolean => {
  const textModelName = getTextModel().modelName;
  return BedrockThinkingModels.includes(textModelName);
};

function isConfigured(): boolean {
  return getApiPrefix().startsWith('http') && getApiKey().length > 0;
}
