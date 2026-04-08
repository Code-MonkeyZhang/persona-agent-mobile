import { Model, Usage, UsagePrice } from '../types/Chat.ts';

export const getUsagePrice = (usage: Usage): UsagePrice => {
  const usagePrice: UsagePrice = {
    modelName: usage.modelName,
    inputPrice: 0,
    outputPrice: 0,
    totalPrice: 0,
  };
  usagePrice.inputPrice = Number(
    (
      (usage.inputTokens *
        (ModelPrice.textModelPrices[usage.modelName]?.inputTokenPrice ??
          -1)) /
      1000
    ).toFixed(6)
  );

  usagePrice.outputPrice = Number(
    (
      (usage.outputTokens *
        (ModelPrice.textModelPrices[usage.modelName]?.outputTokenPrice ??
          -4)) /
      1000
    ).toFixed(6)
  );
  usagePrice.totalPrice = Number(
    (usagePrice.inputPrice + usagePrice.outputPrice).toFixed(2)
  );
  return usagePrice;
};

export const ModelPrice: ModelPriceType = {
  textModelPrices: {
    'Bedrock DeepSeek-R1': {
      inputTokenPrice: 0.00135,
      outputTokenPrice: 0.0054,
    },
    'DeepSeek-V3': {
      inputTokenPrice: 0.00027,
      outputTokenPrice: 0.0011,
    },
    'DeepSeek-R1': {
      inputTokenPrice: 0.00055,
      outputTokenPrice: 0.00219,
    },
    'GPT-4.1': {
      inputTokenPrice: 0.002,
      outputTokenPrice: 0.008,
    },
    'GPT-4.1-mini': {
      inputTokenPrice: 0.0004,
      outputTokenPrice: 0.0016,
    },
    'GPT-4.1-nano': {
      inputTokenPrice: 0.0001,
      outputTokenPrice: 0.0004,
    },
    'GPT-4o': {
      inputTokenPrice: 0.0025,
      outputTokenPrice: 0.01,
    },
    'GPT-4o mini': {
      inputTokenPrice: 0.00015,
      outputTokenPrice: 0.0006,
    },
    'gpt-oss-20b': {
      inputTokenPrice: 0.00007,
      outputTokenPrice: 0.0003,
    },
    'gpt-oss-120b': {
      inputTokenPrice: 0.00015,
      outputTokenPrice: 0.0006,
    },
    'Minimax M2': {
      inputTokenPrice: 0.0003,
      outputTokenPrice: 0.0012,
    },
    'Titan Text G1 - Lite': {
      inputTokenPrice: 0.00015,
      outputTokenPrice: 0.0002,
    },
    'Titan Text G1 - Express': {
      inputTokenPrice: 0.0002,
      outputTokenPrice: 0.0006,
    },
    'Titan Text G1 - Premier': {
      inputTokenPrice: 0.0005,
      outputTokenPrice: 0.0015,
    },
    'Nova Pro': {
      inputTokenPrice: 0.0008,
      outputTokenPrice: 0.0032,
    },
    'Nova Lite': {
      inputTokenPrice: 0.00006,
      outputTokenPrice: 0.00024,
    },
    'Nova 2 Lite': {
      inputTokenPrice: 0.0003,
      outputTokenPrice: 0.0025,
    },
    'Nova Micro': {
      inputTokenPrice: 0.000035,
      outputTokenPrice: 0.00014,
    },
    'Claude 3.5 Sonnet v2': {
      inputTokenPrice: 0.003,
      outputTokenPrice: 0.015,
    },
    'Claude 3.5 Haiku': {
      inputTokenPrice: 0.0008,
      outputTokenPrice: 0.004,
    },
    'Claude Instant': {
      inputTokenPrice: 0.0008,
      outputTokenPrice: 0.0024,
    },
    Claude: {
      inputTokenPrice: 0.008,
      outputTokenPrice: 0.024,
    },
    'Claude 3 Sonnet': {
      inputTokenPrice: 0.003,
      outputTokenPrice: 0.015,
    },
    'Claude 3 Haiku': {
      inputTokenPrice: 0.00025,
      outputTokenPrice: 0.00125,
    },
    'Claude 3 Opus': {
      inputTokenPrice: 0.015,
      outputTokenPrice: 0.075,
    },
    'Claude 3.5 Sonnet': {
      inputTokenPrice: 0.003,
      outputTokenPrice: 0.015,
    },
    'Claude 3.7 Sonnet': {
      inputTokenPrice: 0.003,
      outputTokenPrice: 0.015,
    },
    'Claude Sonnet 4': {
      inputTokenPrice: 0.003,
      outputTokenPrice: 0.015,
    },
    'Claude Sonnet 4.5': {
      inputTokenPrice: 0.003,
      outputTokenPrice: 0.015,
    },
    'Claude Opus 4.5': {
      inputTokenPrice: 0.005,
      outputTokenPrice: 0.025,
    },
    'Claude Haiku 4.5': {
      inputTokenPrice: 0.001,
      outputTokenPrice: 0.005,
    },
    Command: {
      inputTokenPrice: 0.0015,
      outputTokenPrice: 0.002,
    },
    'Command R': {
      inputTokenPrice: 0.0005,
      outputTokenPrice: 0.0015,
    },
    'Command R+': {
      inputTokenPrice: 0.003,
      outputTokenPrice: 0.015,
    },
    'Command Light': {
      inputTokenPrice: 0.0003,
      outputTokenPrice: 0.0006,
    },
    'Llama 3 8B Instruct': {
      inputTokenPrice: 0.0003,
      outputTokenPrice: 0.0006,
    },
    'Llama 3 70B Instruct': {
      inputTokenPrice: 0.00265,
      outputTokenPrice: 0.0035,
    },
    'Llama 3.1 8B Instruct': {
      inputTokenPrice: 0.00022,
      outputTokenPrice: 0.00022,
    },
    'Llama 3.1 70B Instruct': {
      inputTokenPrice: 0.00072,
      outputTokenPrice: 0.00072,
    },
    'Llama 3.1 405B Instruct': {
      inputTokenPrice: 0.0024,
      outputTokenPrice: 0.0024,
    },
    'Llama 3.2 1B Instruct': {
      inputTokenPrice: 0.0001,
      outputTokenPrice: 0.0001,
    },
    'Llama 3.2 3B Instruct': {
      inputTokenPrice: 0.00015,
      outputTokenPrice: 0.00015,
    },
    'Llama 3.2 11B Instruct': {
      inputTokenPrice: 0.00016,
      outputTokenPrice: 0.00016,
    },
    'Llama 3.2 90B Instruct': {
      inputTokenPrice: 0.00072,
      outputTokenPrice: 0.00072,
    },
    'Mistral 7B Instruct': {
      inputTokenPrice: 0.00015,
      outputTokenPrice: 0.0002,
    },
    'Mixtral 8x7B Instruct': {
      inputTokenPrice: 0.00045,
      outputTokenPrice: 0.0007,
    },
    'Mistral Small (24.02)': {
      inputTokenPrice: 0.001,
      outputTokenPrice: 0.003,
    },
    'Mistral Large (24.02)': {
      inputTokenPrice: 0.004,
      outputTokenPrice: 0.012,
    },
    'Mistral Large (24.07)': {
      inputTokenPrice: 0.002,
      outputTokenPrice: 0.006,
    },
    'Jamba-Instruct': {
      inputTokenPrice: 0.0005,
      outputTokenPrice: 0.0007,
    },
    'Jamba 1.5 Large': {
      inputTokenPrice: 0.002,
      outputTokenPrice: 0.008,
    },
    'Jamba 1.5 Mini': {
      inputTokenPrice: 0.0002,
      outputTokenPrice: 0.0004,
    },
  },
};

interface ModelPriceType {
  textModelPrices: Record<
    string,
    { inputTokenPrice: number; outputTokenPrice: number }
  >;
}

export function getTotalCost(usage: Usage[]) {
  return Number(
    usage
      .filter(modelUsage => getUsagePrice(modelUsage).totalPrice > 0)
      .reduce((sum, model) => sum + getUsagePrice(model).totalPrice, 0)
      .toFixed(2)
  );
}

export function getTotalInputTokens(usage: Usage[]) {
  return usage.reduce((sum, model) => sum + (model.inputTokens || 0), 0);
}

export function getTotalInputPrice(usage: Usage[]) {
  return Number(
    usage
      .filter(modelUsage => getUsagePrice(modelUsage).inputPrice > 0)
      .reduce((sum, model) => sum + getUsagePrice(model).inputPrice, 0)
      .toFixed(6)
  );
}

export function getTotalOutputTokens(usage: Usage[]) {
  return usage.reduce((sum, model) => sum + (model.outputTokens || 0), 0);
}

export function getTotalOutputPrice(usage: Usage[]) {
  return Number(
    usage
      .filter(modelUsage => getUsagePrice(modelUsage).outputPrice > 0)
      .reduce((sum, model) => sum + getUsagePrice(model).outputPrice, 0)
      .toFixed(6)
  );
}

export function addBedrockPrefixToDeepseekModels(models: Model[]): void {
  for (let i = 0; i < models.length; i++) {
    if (models[i].modelName.toLowerCase().includes('deepseek')) {
      models[i] = {
        ...models[i],
        modelName: `Bedrock ${models[i].modelName}`,
      };
    }
  }
}
