/**
 * @file storage/launcher-prefs.ts
 * @description 小手机偏好的镜像与提交中枢。
 *   星型拓扑，两端互不同步各自只对服务器，冲突按服务端 updatedAt 后写赢。
 *   快照与变更流写入前先比时间戳，本地写后 500 毫秒去抖提交，
 *   提交失败保留待重交标记，连接恢复后照标记重交。
 *   本文件只含可注入依赖的逻辑，真实单例装配在 sync-setup，测试用手写假实现。
 */
import type {
  LauncherOrderDoc,
  LauncherPrefEntry,
  LauncherPrefKey,
  LauncherPrefsChangeData,
  LauncherSnapshot,
  SessionChange,
  WallpaperDoc,
} from './sync-shapes.ts';

/** 偏好中枢的可注入依赖，测试用手写假实现替换 */
export interface LauncherPrefsDeps {
  /** 字符串键值存取，真身是 MMKV */
  kv: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
    delete: (key: string) => void;
  };
  putOrder: (
    address: string,
    appOrder: (string | null)[]
  ) => Promise<LauncherPrefEntry<LauncherOrderDoc>>;
  putWallpaper: (
    address: string,
    currentId: string | null
  ) => Promise<LauncherPrefEntry<WallpaperDoc>>;
  getServerAddress: () => string;
  log: (message: string) => void;
}

/** 本地写后去抖提交的间隔 */
const SUBMIT_DEBOUNCE_MS = 500;

const ORDER_KEY = 'bedrock/launcher/appOrder';
const WALLPAPER_KEY = 'bedrock/launcher/wallpaper';
/** 语义键到 MMKV 存储键的映射 */
const STORAGE_KEYS: Record<LauncherPrefKey, string> = {
  appOrder: ORDER_KEY,
  wallpaper: WALLPAPER_KEY,
};
/** 步骤七遗留的本地壁纸键，迁移一次后删除 */
const LEGACY_WALLPAPER_KEY = 'bedrock/launcher/wallpaperCurrent';
/** 待重交标记的键前缀 */
const PENDING_PREFIX = 'bedrock/launcher/pending/';

export class LauncherPrefs {
  private listeners = new Set<() => void>();
  private timers: Partial<
    Record<LauncherPrefKey, ReturnType<typeof setTimeout>>
  > = {};

  constructor(private readonly deps: LauncherPrefsDeps) {
    this.migrateLegacy();
  }

  /**
   * 旧格式迁移。
   * - 排列键曾是裸数组，包一层信封，updatedAt 归零等服务器裁决
   * - 壁纸曾是单值 id，升成完整文档，迁完删旧键
   */
  private migrateLegacy(): void {
    const rawOrder = this.deps.kv.get(ORDER_KEY);
    if (rawOrder !== undefined) {
      try {
        const parsed = JSON.parse(rawOrder) as unknown;
        if (Array.isArray(parsed)) {
          this.writeEntry('appOrder', {
            payload: { appOrder: parsed as (string | null)[] },
            updatedAt: 0,
          });
          this.deps.log('migrated bare appOrder into envelope');
        }
      } catch {
        this.deps.kv.delete(ORDER_KEY);
      }
    }
    const legacy = this.deps.kv.get(LEGACY_WALLPAPER_KEY);
    if (legacy !== undefined) {
      if (legacy && this.deps.kv.get(WALLPAPER_KEY) === undefined) {
        this.writeEntry('wallpaper', {
          payload: { currentId: legacy, customs: [] },
          updatedAt: 0,
        });
        this.deps.log('migrated legacy wallpaperCurrent into doc');
      }
      this.deps.kv.delete(LEGACY_WALLPAPER_KEY);
    }
  }

  private readEntry<T>(key: LauncherPrefKey): LauncherPrefEntry<T> | null {
    const raw = this.deps.kv.get(STORAGE_KEYS[key]);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as LauncherPrefEntry<T>;
      return parsed && typeof parsed.updatedAt === 'number' && parsed.payload
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private writeEntry(
    key: LauncherPrefKey,
    entry: LauncherPrefEntry<LauncherOrderDoc | WallpaperDoc>
  ): void {
    this.deps.kv.set(STORAGE_KEYS[key], JSON.stringify(entry));
  }

  getOrderDoc(): LauncherOrderDoc | null {
    return this.readEntry<LauncherOrderDoc>('appOrder')?.payload ?? null;
  }

  getWallpaperDoc(): WallpaperDoc | null {
    return this.readEntry<WallpaperDoc>('wallpaper')?.payload ?? null;
  }

  private isPending(key: LauncherPrefKey): boolean {
    return this.deps.kv.get(PENDING_PREFIX + key) === '1';
  }

  private setPending(key: LauncherPrefKey, pending: boolean): void {
    if (pending) {
      this.deps.kv.set(PENDING_PREFIX + key, '1');
    } else {
      this.deps.kv.delete(PENDING_PREFIX + key);
    }
  }

  /** 本地写排列，保留原时间戳占位，去抖提交，界面立即可读 */
  saveLocalOrder(appOrder: (string | null)[]): void {
    const prev = this.readEntry<LauncherOrderDoc>('appOrder');
    this.writeEntry('appOrder', {
      payload: { appOrder },
      updatedAt: prev?.updatedAt ?? 0,
    });
    this.setPending('appOrder', true);
    this.notify();
    this.scheduleSubmit('appOrder');
  }

  /** 本地写壁纸文档，语义同排列 */
  saveLocalWallpaper(doc: WallpaperDoc): void {
    const prev = this.readEntry<WallpaperDoc>('wallpaper');
    this.writeEntry('wallpaper', {
      payload: doc,
      updatedAt: prev?.updatedAt ?? 0,
    });
    this.setPending('wallpaper', true);
    this.notify();
    this.scheduleSubmit('wallpaper');
  }

  /**
   * 远端条目按时间戳落地。
   * 本地不比远端旧则忽略，覆盖后清待重交标记，被覆盖的本地编辑按后写赢让位。
   */
  private applyEntry(
    key: LauncherPrefKey,
    entry: LauncherPrefEntry<LauncherOrderDoc | WallpaperDoc>
  ): boolean {
    const current = this.readEntry(key);
    if (current && current.updatedAt >= entry.updatedAt) {
      return false;
    }
    this.writeEntry(key, entry);
    this.setPending(key, false);
    this.deps.log(`remote ${key} applied, updatedAt=${entry.updatedAt}`);
    return true;
  }

  /** 快照的 launcher 节逐键落地，有变化才通知界面重读 */
  applySnapshot(node: LauncherSnapshot | undefined): void {
    if (!node) return;
    let changed = false;
    if (node.appOrder) {
      changed = this.applyEntry('appOrder', node.appOrder) || changed;
    }
    if (node.wallpaper) {
      changed = this.applyEntry('wallpaper', node.wallpaper) || changed;
    }
    if (changed) this.notify();
  }

  /** 变更流事件，launcher_prefs_updated 之外的种类直接忽略 */
  applyChange(change: SessionChange): void {
    if (change.kind !== 'launcher_prefs_updated') return;
    const data = change.data as LauncherPrefsChangeData;
    if (!data?.key) return;
    if (
      this.applyEntry(data.key, {
        payload: data.payload,
        updatedAt: data.updatedAt,
      })
    ) {
      this.notify();
    }
  }

  /** 应用接口响应带回的壁纸信封，上传与删除后即时落地并通知界面 */
  applyWallpaperEntry(entry: LauncherPrefEntry<WallpaperDoc>): void {
    if (this.applyEntry('wallpaper', entry)) {
      this.notify();
    }
  }

  private scheduleSubmit(key: LauncherPrefKey): void {
    const existing = this.timers[key];
    if (existing) clearTimeout(existing);
    this.timers[key] = setTimeout(() => {
      delete this.timers[key];
      this.submit(key).catch(() => undefined);
    }, SUBMIT_DEBOUNCE_MS);
  }

  /** 提交当前文档，成功回写服务器时间戳并清待重交，失败保留标记等重连 */
  private async submit(key: LauncherPrefKey): Promise<void> {
    const address = this.deps.getServerAddress();
    const entry = this.readEntry(key);
    if (!entry || !address) return;
    try {
      const response =
        key === 'appOrder'
          ? await this.deps.putOrder(
              address,
              (entry.payload as LauncherOrderDoc).appOrder
            )
          : await this.deps.putWallpaper(
              address,
              (entry.payload as WallpaperDoc).currentId
            );
      this.writeEntry(key, response);
      this.setPending(key, false);
      this.deps.log(`submit ${key} ok, updatedAt=${response.updatedAt}`);
    } catch (e) {
      this.setPending(key, true);
      this.deps.log(
        `submit ${key} failed: ${e instanceof Error ? e.message : e}`
      );
    }
  }

  /**
   * 作废本地偏好镜像。
   * 换主机或序号流错位时由同步引擎调用，两份文档与待重交标记全部清掉，
   * 快照随后的整份重放不被本地时间戳挡路。
   */
  invalidate(): void {
    (['appOrder', 'wallpaper'] as LauncherPrefKey[]).forEach((key) => {
      this.deps.kv.delete(STORAGE_KEYS[key]);
      this.setPending(key, false);
    });
    this.deps.log('mirror invalidated');
    this.notify();
  }

  /** 连接恢复后照待重交标记立即补交 */
  retryPending(): void {
    (['appOrder', 'wallpaper'] as LauncherPrefKey[]).forEach((key) => {
      if (this.isPending(key)) {
        this.submit(key).catch(() => undefined);
      }
    });
  }

  /** 界面重读的监听，返回注销函数 */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
