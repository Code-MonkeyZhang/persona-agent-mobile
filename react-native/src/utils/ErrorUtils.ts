import { LogBox } from 'react-native';
import { logger } from '../lib/logger';

/** RN 全局异常工具的类型；挂在 globalThis 上但官方类型不全，故手动声明 */
type ErrorUtilsLike = {
  setGlobalHandler: (handler: (error: Error, isFatal: boolean) => void) => void;
  getGlobalHandler?: () => (error: Error, isFatal: boolean) => void;
};

/**
 * 配置全局错误处理：
 * - 抑制已知的无害 LogBox 警告
 * - 接管未捕获的 JS 异常写入日志文件，并链回默认 handler 保留 dev 红框 / release 崩溃行为
 */
export const configureErrorHandling = () => {
  LogBox.ignoreLogs([/Invalid\s+responseType:\s+blob/i]);
  logger.info('[App] LogBox ignoreLogs configured');

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) {
    logger.warn('[App] ErrorUtils.setGlobalHandler unavailable');
    return;
  }

  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      logger.error(
        `[Uncaught${isFatal ? ' Fatal' : ''}] ${error?.name ?? 'Error'}: ${
          error?.message ?? ''
        }`,
        error?.stack
      );
    } catch {
      // 捕获逻辑本身不能再抛
    }
    previous?.(error, isFatal);
  });
  logger.info('[App] global error handler installed');
};
