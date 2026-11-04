/**
 * 校验 zh 与 en 两份语言包的键完全一致，避免单边漏键。
 */
import zh from '../src/i18n/locales/zh.json';
import en from '../src/i18n/locales/en.json';

/** 递归收集扁平键路径 */
const collectKeys = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? collectKeys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );

test('zh 与 en 的 i18n 键完全一致', () => {
  const zhKeys = collectKeys(zh).sort();
  const enKeys = collectKeys(en).sort();
  expect(zhKeys).toEqual(enKeys);
});
