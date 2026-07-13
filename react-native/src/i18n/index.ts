/**
 * @file i18n/index.ts
 * @description i18next 初始化模块。根据系统语言自动选择中文或英文，
 *              简体/繁体中文统一映射为 zh，其余语言回退为 en。
 *              组件中使用 useTranslation() hook，非组件代码直接用 i18n.t()。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import { logger } from '../lib/logger';
import zh from './locales/zh.json';
import en from './locales/en.json';

/**
 * 检测系统语言并映射为 i18n 支持的类型。
 * 语言代码以 zh 开头（简体 zh-Hans、繁体 zh-Hant）返回 zh，其余返回 en。
 */
export function detectLanguage(): 'zh' | 'en' {
  const locales = getLocales();
  const code = locales[0]?.languageCode ?? 'en';
  return code.startsWith('zh') ? 'zh' : 'en';
}

const detected = detectLanguage();
logger.info(`[i18n] initialized, detected language: ${detected}`);

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: detected,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
