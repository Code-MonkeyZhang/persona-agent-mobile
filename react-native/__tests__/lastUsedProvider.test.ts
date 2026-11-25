/**
 * @file lastUsedProvider.test.ts
 * @description 上次使用供应商读写的直测，假 MMKV 落内存表。
 */
import {
  getLastUsedProvider,
  saveLastUsedProvider,
} from '../src/storage/StorageUtils';

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
      getString(key: string) {
        return store.get(key);
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

describe('上次使用供应商的读写', () => {
  it('未写入时读到空字符串', () => {
    expect(getLastUsedProvider()).toBe('');
  });

  it('保存后读到同一家的 id 并落盘', () => {
    saveLastUsedProvider('zai');

    expect(getLastUsedProvider()).toBe('zai');
    expect(mmkvStore.get('bedrock/lastUsedProvider')).toBe('zai');
  });

  it('再次保存覆盖前一家', () => {
    saveLastUsedProvider('kimi-coding');

    expect(getLastUsedProvider()).toBe('kimi-coding');
    expect(mmkvStore.get('bedrock/lastUsedProvider')).toBe('kimi-coding');
  });
});
