/**
 * @file storage/image-cache.ts
 * @description 客户端图片缓存核心，内容哈希承担缓存身份，照桌面端 image-cache 的图纸。
 *   已看过的图片以 sha256 十六进制串为文件名落在缓存目录，命中路径零网络回流。
 *   缓存键从图片地址的 h 查询参数提取，网络地址只承担未命中路径的一次性传输。
 *   文件操作与哈希函数经构造注入，模块不依赖 react-native，jest 可直测。
 */

/** 内容哈希的严格格式，64 位小写十六进制 */
const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** 响应 Content-Type 到文件扩展名的映射，扩展名只服务可读性，解码按内容嗅探 */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** 文件操作与哈希的外部依赖，RNFS 实现在组件层注入，测试注入替身 */
export interface ImageCacheDeps {
  /** 建缓存目录，已存在时静默成功 */
  mkdir(path: string): Promise<void>;
  /** 列目录内全部文件名 */
  readDir(path: string): Promise<string[]>;
  /** 删除文件，目标不存在时静默成功 */
  unlink(path: string): Promise<void>;
  /** 原子改名，落盘的临门一脚 */
  moveFile(from: string, to: string): Promise<void>;
  /** 计算文件的 sha256 十六进制摘要 */
  sha256(path: string): Promise<string>;
  /** 下载 url 到文件，返回响应状态码与 Content-Type */
  download(
    url: string,
    toFile: string
  ): Promise<{ statusCode: number; contentType?: string }>;
  /** 结构化日志 */
  log(message: string): void;
}

/**
 * 从图片地址提取内容哈希缓存键。
 * 只认 h 查询参数且要求 64 位十六进制格式，其余形状返回 null 由调用方走远端直显。
 */
export function parseHashKey(source: string): string | null {
  const queryAt = source.indexOf('?');
  if (queryAt === -1) {
    return null;
  }
  for (const pair of source.slice(queryAt + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (pair.slice(0, eq) === 'h' && eq === 1) {
      const value = pair.slice(eq + 1);
      return HASH_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

/** Content-Type 映射扩展名，未知类型兜底 bin */
function extFromContentType(contentType?: string): string {
  if (!contentType) {
    return 'bin';
  }
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return MIME_EXT[mime] ?? 'bin';
}

/** 已知失败的记忆哨兵，避免同一键反复下载注定失败的资源 */
const FAILED = '';

/** 图片缓存，单个实例管理一个缓存目录 */
export class ImageCache {
  /** 哈希到本地路径的记忆映射，冷启动后首次访问扫目录填充 */
  private readonly memo = new Map<string, string>();
  /** 同键进行中的下载 Promise，并发请求共享一次下载 */
  private readonly inflight = new Map<string, Promise<string | null>>();
  /** 进行中的目录扫描 Promise，并发首访共享同一次扫描，全部等扫描落地后再查记忆映射 */
  private scanPromise: Promise<void> | null = null;

  constructor(
    private readonly cacheDir: string,
    private readonly deps: ImageCacheDeps
  ) {}

  /** 同步查本地路径，只看记忆映射，供组件首帧避免闪远端 */
  peek(source: string): string | null {
    const key = parseHashKey(source);
    if (!key) {
      return null;
    }
    const cached = this.memo.get(key);
    return cached && cached !== FAILED ? cached : null;
  }

  /**
   * 解析图片地址到本地路径。
   * 命中返回 file:// 可用的绝对路径，未命中下载校验落盘后返回，
   * 地址无合法哈希或任何一步失败返回 null，调用方回退远端直显。
   */
  resolve(source: string): Promise<string | null> {
    const key = parseHashKey(source);
    if (!key) {
      return Promise.resolve(null);
    }
    const known = this.memo.get(key);
    if (known !== undefined) {
      return Promise.resolve(known === FAILED ? null : known);
    }
    const running = this.inflight.get(key);
    if (running) {
      return running;
    }
    const work = this.fetchToFile(source, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, work);
    return work;
  }

  /**
   * 清除失败哨兵，让下一次 resolve 重新尝试下载。
   * 哨兵是会话级记忆，排队下载的重试节奏靠它解除失败锁定。
   */
  clearFailure(source: string): void {
    const key = parseHashKey(source);
    if (key && this.memo.get(key) === FAILED) {
      this.memo.delete(key);
    }
  }

  /**
   * 预热记忆映射，App 启动时调用一次。
   * 与首访共享同一条扫描，让首帧 peek 在扫描完成后同步命中本地路径。
   */
  warmup(): Promise<void> {
    return this.scanOnce();
  }

  /** 未命中路径的完整流程：扫目录、下载、校验、落盘 */
  private async fetchToFile(
    source: string,
    key: string
  ): Promise<string | null> {
    await this.scanOnce();
    const known = this.memo.get(key);
    if (known !== undefined) {
      return known === FAILED ? null : known;
    }
    const tempPath = `${this.cacheDir}/${key}.download`;
    try {
      await this.deps.mkdir(this.cacheDir);
      const { statusCode, contentType } = await this.deps.download(
        source,
        tempPath
      );
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`download status ${statusCode}`);
      }
      const digest = await this.deps.sha256(tempPath);
      if (digest !== key) {
        this.deps.log(`hash mismatch key=${key} got=${digest}`);
        this.memo.set(key, FAILED);
        await this.deps.unlink(tempPath).catch(() => undefined);
        return null;
      }
      const finalPath = `${this.cacheDir}/${key}.${extFromContentType(
        contentType
      )}`;
      // 移动端改名原语拒绝覆盖已存在目标，先移除同名旧文件使落盘幂等
      await this.deps.unlink(finalPath).catch(() => undefined);
      await this.deps.moveFile(tempPath, finalPath);
      this.memo.set(key, finalPath);
      this.deps.log(`stored ${key} ${finalPath}`);
      return finalPath;
    } catch (error) {
      this.memo.set(key, FAILED);
      await this.deps.unlink(tempPath).catch(() => undefined);
      this.deps.log(
        `fetch failed key=${key} ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * 冷启动后首次访问扫一遍目录，把已落盘文件填进记忆映射。
   * 并发首访共享同一次扫描，等扫描真正完成后再查映射，
   * 避免后来者越过未完成的扫描误判未命中而重复下载。
   */
  private scanOnce(): Promise<void> {
    if (!this.scanPromise) {
      this.scanPromise = this.scanDir();
    }
    return this.scanPromise;
  }

  /** 目录扫描实现，读取失败按空目录处理，download 临时残留不进记忆映射 */
  private async scanDir(): Promise<void> {
    const names = await this.deps.readDir(this.cacheDir).catch(() => []);
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.(?!download$)\w+$/.exec(name);
      if (match) {
        this.memo.set(match[1], `${this.cacheDir}/${name}`);
      }
    }
    this.deps.log(`scanned cache dir, ${names.length} files`);
  }
}
