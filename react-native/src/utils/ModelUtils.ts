import { Model, ModelTag } from '../types/Chat.ts';

export function getModelTag(model: Model): string {
  return model.modelTag ?? ModelTag.OpenAICompatible;
}

export const getModelIcon = (
  _modelTag: string,
  _modelId: string | undefined,
  _isDark: boolean
) => {
  return require('../assets/openai_api.png');
};

export function getModelTagByUserName(
  modelTag: string | undefined,
  _userName: string
): string {
  return modelTag ?? ModelTag.OpenAICompatible;
}
