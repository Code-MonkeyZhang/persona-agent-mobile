/**
 * @file src/lib/logger.ts
 * @description 统一日志出口。每条日志同时输出到 console 和内存缓冲；
 *   内存缓冲定时批量落盘到 DocumentDirectoryPath/logs/app-YYYY-MM-DD.log，
 *   按天切文件，启动时清理 RETENTION_DAYS 前的旧文件。
 *   - console 保留原始 args，让 Metro / Xcode 能展开对象
 *   - 文件单行序列化（对象走 JSON.stringify），便于 grep / 跨文件分析
 *   - error 级立即 flush，保证崩溃前的错误一定落盘
 *   - 进后台 / 异常捕获时由调用方主动调 flush
 */
import RNFS from 'react-native-fs';

const FLUSH_INTERVAL_MS = 3_000;
const RETENTION_DAYS = 7;
const LOG_DIR = `${RNFS.DocumentDirectoryPath}/logs`;

const LEVEL_INFO = 'INFO ';
const LEVEL_WARN = 'WARN ';
const LEVEL_ERROR = 'ERROR';
const LEVEL_DEBUG = 'DEBUG';

/** 内存缓冲：到达 FLUSH_INTERVAL_MS 或 error 级触发时一次性写出 */
const buffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
/** 标记日志目录是否已就绪，避免每次 flush 都 stat 一次 */
let logDirReady = false;
/** 当前正在进行的 flush；并发触发合并到同一 Promise 避免竞态 */
let pendingFlush: Promise<void> | null = null;

/**
 * 为一次日志构造带日期与级别的前缀字符串。
 * - 时间取本地时钟，含毫秒，加日期前缀方便跨天分析
 * - 级别定宽 5 字符对齐
 */
function buildPrefix(level: string): string {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  const ts =
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ` +
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(
      now.getSeconds()
    )}` +
    `.${pad3(now.getMilliseconds())}`;
  return `${ts} ${level}`;
}

/** 把单个 arg 序列化成单行字符串；JSON.stringify 失败时退到 String() */
function serialize(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** 当前日期对应的日志文件绝对路径，跨天自动滚到新文件 */
function getCurrentLogPath(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;
  return `${LOG_DIR}/app-${dateStr}.log`;
}

/** 确保日志目录存在；成功后置 logDirReady，后续 flush 跳过 stat */
async function ensureLogDir(): Promise<void> {
  if (logDirReady) {
    return;
  }
  try {
    const exists = await RNFS.exists(LOG_DIR);
    if (!exists) {
      await RNFS.mkdir(LOG_DIR);
    }
    logDirReady = true;
  } catch (e) {
    console.warn('[Logger] ensureLogDir failed:', e);
  }
}

/** 把缓冲区内容追加到当天日志文件；落盘失败只 warn，避免日志循环 */
async function doFlush(): Promise<void> {
  if (buffer.length === 0) {
    return;
  }
  await ensureLogDir();
  const chunk = buffer.splice(0, buffer.length).join('\n') + '\n';
  try {
    await RNFS.appendFile(getCurrentLogPath(), chunk, 'utf8');
  } catch (e) {
    console.warn('[Logger] flush failed:', e);
  }
}

/**
 * 把缓冲区内容 flush 到磁盘。
 * - 并发触发合并到同一个 Promise，避免竞态
 * - 公开供 App.tsx 进后台、ErrorUtils 异常时主动调用
 */
function flush(): Promise<void> {
  if (pendingFlush) {
    return pendingFlush;
  }
  pendingFlush = doFlush().finally(() => {
    pendingFlush = null;
  });
  return pendingFlush;
}

/** 把日志同时打到 console（保留原始 args）和内存缓冲（单行序列化） */
function emit(level: string, args: unknown[]): void {
  const prefix = buildPrefix(level);
  console.log(prefix, ...args);
  buffer.push(`${prefix} ${args.map(serialize).join(' ')}`);
  if (level === LEVEL_ERROR) {
    flush();
  }
}

/**
 * 清理超过 RETENTION_DAYS 天的旧日志文件。
 * 按文件名里的日期判断，不依赖 mtime，避免系统时间被改影响。
 */
async function cleanOldLogs(): Promise<void> {
  let files: { name: string; path: string }[];
  try {
    files = await RNFS.readDir(LOG_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of files) {
    const m = f.name.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
    if (!m) {
      continue;
    }
    const fileTime = new Date(`${m[1]}T00:00:00`).getTime();
    if (Number.isNaN(fileTime) || fileTime < cutoff) {
      try {
        await RNFS.unlink(f.path);
        removed++;
      } catch {
        // 单个文件删失败不阻塞其他清理
      }
    }
  }
  if (removed > 0) {
    console.log(`[Logger] cleaned ${removed} old log file(s)`);
  }
}

export const logger = {
  info: (...args: unknown[]): void => emit(LEVEL_INFO, args),
  warn: (...args: unknown[]): void => emit(LEVEL_WARN, args),
  error: (...args: unknown[]): void => emit(LEVEL_ERROR, args),
  debug: (...args: unknown[]): void => emit(LEVEL_DEBUG, args),

  /**
   * 启动日志系统：建目录、清理过期文件、启动定时 flush。
   * 在 App.tsx 根 useEffect 里调用一次，且早于 coldStart。
   */
  init: async (): Promise<void> => {
    await ensureLogDir();
    await cleanOldLogs();
    if (flushTimer === null) {
      flushTimer = setInterval(() => {
        flush();
      }, FLUSH_INTERVAL_MS);
    }
    console.log(`[Logger] initialized, logDir=${LOG_DIR}`);
  },

  /** 主动把缓冲落盘。App 进后台、异常捕获时调用 */
  flush,
};
