/**
 * @file launcherPrefs.test.ts
 * @description 小手机偏好中枢的直测，注入假 kv 与假提交函数，
 *   覆盖旧格式迁移、LWW 裁决、自身回声忽略、去抖合并提交、失败重交。
 */
import {
  LauncherPrefs,
  type LauncherPrefsDeps,
} from '../src/storage/launcher-prefs';
import type {
  LauncherPrefEntry,
  SessionChange,
  WallpaperDoc,
} from '../src/storage/sync-shapes';

/** 假 kv，行为对齐 MMKV 的字符串三件套 */
function fakeKv() {
  const map = new Map<string, string>();
  return {
    map,
    deps: {
      get: (key: string) => map.get(key),
      set: (key: string, value: string) => void map.set(key, value),
      delete: (key: string) => void map.delete(key),
    },
  };
}

interface Harness {
  prefs: LauncherPrefs;
  kv: ReturnType<typeof fakeKv>;
  putOrder: jest.Mock;
  putWallpaper: jest.Mock;
  logs: string[];
}

/** 组装被测对象，提交函数默认成功并回递增时间戳 */
function harness(options?: {
  putOrderResult?: 'ok' | 'fail';
  putWallpaperResult?: 'ok' | 'fail';
}): Harness {
  const kv = fakeKv();
  const logs: string[] = [];
  let clock = 1000;
  const putOrder = jest.fn(() =>
    options?.putOrderResult === 'fail'
      ? Promise.reject(new Error('network down'))
      : Promise.resolve({
          payload: { appOrder: [] },
          updatedAt: ++clock,
        })
  );
  const putWallpaper = jest.fn(() =>
    options?.putWallpaperResult === 'fail'
      ? Promise.reject(new Error('network down'))
      : Promise.resolve({
          payload: { currentId: null, customs: [] },
          updatedAt: ++clock,
        })
  );
  const deps: LauncherPrefsDeps = {
    kv: kv.deps,
    putOrder,
    putWallpaper,
    getServerAddress: () => 'http://server',
    log: (message) => logs.push(message),
  };
  return { prefs: new LauncherPrefs(deps), kv, putOrder, putWallpaper, logs };
}

function changeOf(
  key: 'appOrder' | 'wallpaper',
  payload: unknown,
  updatedAt: number
): SessionChange {
  return {
    seq: 1,
    kind: 'launcher_prefs_updated',
    sessionId: null,
    data: { key, payload, updatedAt },
    createdAt: updatedAt,
  };
}

const WALL_DOC: WallpaperDoc = { currentId: 'sunset', customs: [] };

describe('LauncherPrefs 作废', () => {
  it('作废清空两份文档与待重交标记并通知界面', () => {
    const h = harness();
    h.prefs.saveLocalOrder(['a', null]);
    h.prefs.saveLocalWallpaper(WALL_DOC);
    const heard: number[] = [];
    h.prefs.addListener(() => heard.push(1));

    h.prefs.invalidate();
    expect(h.prefs.getOrderDoc()).toBeNull();
    expect(h.prefs.getWallpaperDoc()).toBeNull();
    expect(
      [...h.kv.map.keys()].filter((k) =>
        k.startsWith('bedrock/launcher/pending/')
      )
    ).toEqual([]);
    expect(heard).toHaveLength(1);
  });
});

describe('LauncherPrefs 迁移', () => {
  it('裸数组排列包成信封且时间戳归零', () => {
    const h = harness();
    h.kv.map.set('bedrock/launcher/appOrder', '["a","b"]');
    const late = new LauncherPrefs({
      kv: h.kv.deps,
      putOrder: h.putOrder,
      putWallpaper: h.putWallpaper,
      getServerAddress: () => 'http://server',
      log: (m) => h.logs.push(m),
    });
    expect(late.getOrderDoc()).toEqual({ appOrder: ['a', 'b'] });
    const entry = JSON.parse(
      h.kv.map.get('bedrock/launcher/appOrder') as string
    ) as LauncherPrefEntry<unknown>;
    expect(entry.updatedAt).toBe(0);
  });

  it('旧壁纸单值键升成文档并删除旧键', () => {
    const h = harness();
    h.kv.map.set('bedrock/launcher/wallpaperCurrent', 'sunset');
    new LauncherPrefs({
      kv: h.kv.deps,
      putOrder: h.putOrder,
      putWallpaper: h.putWallpaper,
      getServerAddress: () => 'http://server',
      log: (m) => h.logs.push(m),
    });
    expect(h.kv.map.has('bedrock/launcher/wallpaperCurrent')).toBe(false);
    expect(h.prefs.getWallpaperDoc()).toEqual({
      currentId: 'sunset',
      customs: [],
    });
  });
});

describe('LauncherPrefs LWW', () => {
  it('远端更新落地并通知，旧于本地或等于本地被忽略', () => {
    const h = harness();
    const heard: number[] = [];
    h.prefs.addListener(() => heard.push(1));

    h.prefs.applyChange(changeOf('wallpaper', WALL_DOC, 500));
    expect(h.prefs.getWallpaperDoc()).toEqual(WALL_DOC);
    expect(heard).toHaveLength(1);

    h.prefs.applyChange(changeOf('wallpaper', WALL_DOC, 400));
    h.prefs.applyChange(changeOf('wallpaper', WALL_DOC, 500));
    expect(heard).toHaveLength(1);
  });

  it('快照节点逐键落地，缺席键不动本地', () => {
    const h = harness();
    h.prefs.applySnapshot({
      wallpaper: { payload: WALL_DOC, updatedAt: 900 },
    });
    expect(h.prefs.getWallpaperDoc()).toEqual(WALL_DOC);
    expect(h.prefs.getOrderDoc()).toBeNull();
  });

  it('非偏好种类的事件直接忽略', () => {
    const h = harness();
    const heard: number[] = [];
    h.prefs.addListener(() => heard.push(1));
    h.prefs.applyChange({
      seq: 2,
      kind: 'turn_end',
      sessionId: 's',
      data: { turnEnds: [1] },
      createdAt: 0,
    });
    expect(heard).toHaveLength(0);
  });
});

describe('LauncherPrefs 提交', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('本地保存后自身提交的回声不再落地', async () => {
    const h = harness();
    h.prefs.saveLocalWallpaper(WALL_DOC);
    jest.advanceTimersByTime(500);
    const response = await h.putWallpaper.mock.results[0]?.value;
    const heard: number[] = [];
    h.prefs.addListener(() => heard.push(1));
    h.prefs.applyChange(changeOf('wallpaper', WALL_DOC, response.updatedAt));
    const after = JSON.parse(
      h.kv.map.get('bedrock/launcher/wallpaper') as string
    ) as LauncherPrefEntry<WallpaperDoc>;
    expect(after.updatedAt).toBe(response.updatedAt);
    expect(heard).toHaveLength(0);
  });

  it('本地写后 500 毫秒去抖提交一次，连续写合并', async () => {
    const h = harness();
    h.prefs.saveLocalOrder(['a']);
    h.prefs.saveLocalOrder(['a', 'b']);
    expect(h.putOrder).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(h.putOrder).toHaveBeenCalledTimes(1);
    expect(h.putOrder).toHaveBeenCalledWith('http://server', ['a', 'b']);
  });

  it('提交失败保留待重交标记，重连后补交', async () => {
    const h = harness({ putOrderResult: 'fail' });
    h.prefs.saveLocalOrder(['a']);
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.kv.map.get('bedrock/launcher/pending/appOrder')).toBe('1');

    h.prefs.retryPending();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.putOrder).toHaveBeenCalledTimes(2);
  });

  it('远端覆盖后清待重交标记，重连不再补交', async () => {
    const h = harness({ putOrderResult: 'fail' });
    h.prefs.saveLocalOrder(['a']);
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();

    h.prefs.applyChange(changeOf('appOrder', { appOrder: ['b'] }, 8000));
    expect(h.kv.map.has('bedrock/launcher/pending/appOrder')).toBe(false);

    const calls = h.putOrder.mock.calls.length;
    h.prefs.retryPending();
    expect(h.putOrder.mock.calls.length).toBe(calls);
  });
});
