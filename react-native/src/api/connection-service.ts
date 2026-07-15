/**
 * @file src/api/connection-service.ts
 * @description 服务器连接逻辑封装，供手动输入和扫码两个入口共用。
 *              负责 URL 清洗、发送配对请求、保存地址，不处理任何 UI 状态。
 */
import { httpPost } from './server-api.ts';
import { saveServerAddress } from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';

/** 配对请求超时时间 */
const PAIR_TIMEOUT = 10000;

/** 设备名，后续可接入设备信息库获取真实名称 */
const DEVICE_NAME = 'Persona Mobile';

export interface ConnectResult {
  success: boolean;
  error?: string;
}

/**
 * 连接服务器：清洗 URL → POST /api/pair → 保存地址。
 *
 * - 成功返回 { success: true }
 * - 失败返回 { success: false, error }
 */
export async function connectToServer(url: string): Promise<ConnectResult> {
  const address = url.trim().replace(/\/+$/, '');

  if (!address) {
    return { success: false, error: 'Empty URL' };
  }

  logger.info(`[ConnectionService] Connecting to ${address}`);

  try {
    await httpPost(
      `${address}/api/pair`,
      { deviceName: DEVICE_NAME },
      PAIR_TIMEOUT
    );
    saveServerAddress(address);
    logger.info('[ConnectionService] Connected and saved address');
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error(`[ConnectionService] Connection failed: ${error}`);
    return { success: false, error };
  }
}
