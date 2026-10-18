/**
 * @file settingsStore.test.ts
 * @description 显示偏好仓库的直测，假 MMKV 落内存表，
 *   覆盖默认开启、关闭落盘、重新开启回写。
 */
import { useSettingsStore } from '../src/stores/settingsStore';

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    MMKV: class {
      set(key: string, value: string | number | boolean) {
        store.set(key, String(value));
      }
      getBoolean(key: string) {
        const value = store.get(key);
        // 对齐真实 MMKV：缺失键返回 undefined，让 ?? 默认值生效
        return value === undefined ? undefined : value === 'true';
      }
      delete(key: string) {
        store.delete(key);
      }
    },
    __store: store,
  };
});

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/docs',
}));

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const mmkvStore = (
  jest.requireMock('react-native-mmkv') as {
    __store: Map<string, string>;
  }
).__store;

const STORAGE_KEY = 'bedrock/showThoughtProcess';

describe('settingsStore', () => {
  it('默认显示思考过程入口', () => {
    expect(useSettingsStore.getState().thoughtProcessVisible).toBe(true);
  });

  it('关闭开关时状态与 MMKV 同步落盘', () => {
    useSettingsStore.getState().setThoughtProcessVisible(false);

    expect(useSettingsStore.getState().thoughtProcessVisible).toBe(false);
    expect(mmkvStore.get(STORAGE_KEY)).toBe('false');
  });

  it('重新开启时回写为 true', () => {
    useSettingsStore.getState().setThoughtProcessVisible(false);
    useSettingsStore.getState().setThoughtProcessVisible(true);

    expect(useSettingsStore.getState().thoughtProcessVisible).toBe(true);
    expect(mmkvStore.get(STORAGE_KEY)).toBe('true');
  });
});
