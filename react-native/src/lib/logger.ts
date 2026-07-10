/**
 * @file src/lib/logger.ts
 * @description 统一日志出口，每行自动加 HH:mm:ss.SSS LEVEL 前缀；不落盘、不分级门控
 */

/**
 * 为一次日志构造带时间与级别前缀的参数序列
 * - 时间取本地时钟的时/分/秒/毫秒
 * - 级别定宽 5 字符对齐，由各方法传入
 * - 原始参数原样追加，对象/数组交给 console 原生格式化
 */
function format(level: string, args: unknown[]): unknown[] {
  const now = new Date();
  const time =
    String(now.getHours()).padStart(2, '0') +
    ':' +
    String(now.getMinutes()).padStart(2, '0') +
    ':' +
    String(now.getSeconds()).padStart(2, '0') +
    '.' +
    String(now.getMilliseconds()).padStart(3, '0');
  return [`${time} ${level}`, ...args];
}

/**
 * 统一日志对象，提供 info/warn/error/debug 四级
 * - 全部走 console.log，避免 RN LogBox 拦截 console.error/console.warn 弹出屏幕红黄框
 * - 级别仅体现在前缀文字 INFO/WARN/ERROR/DEBUG，终端不再着色
 * 输出形如：21:05:03.124 INFO  [Tag] 内容
 */
export const logger = {
  info: (...args: unknown[]): void => console.log(...format('INFO ', args)),
  warn: (...args: unknown[]): void => console.log(...format('WARN ', args)),
  error: (...args: unknown[]): void => console.log(...format('ERROR', args)),
  debug: (...args: unknown[]): void => console.log(...format('DEBUG', args)),
};
