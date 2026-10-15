/**
 * @file api/sync-api.ts
 * @description 镜像同步的三个 HTTP 包装。
 *   snapshot 拉冷启动全量镜像，changes 按游标增量追平，handshake 取主机身份供镜像归属识别，
 *   响应形状与服务端路由对齐。snapshot 的超时单独调大，首次镜像的数据量随历史增长。
 */
import { httpGet } from './server-api.ts';
import type { SessionChange, SyncSnapshot } from '../storage/sync-shapes.ts';
import { logger } from '../lib/logger';

const TAG = '[SyncApi]';

/**
 * 拉取冷启动全量快照。
 * @param serverAddress 服务器地址
 * @returns 快照，含全部会话与消息及快照时刻的最新序号
 */
export async function fetchSyncSnapshot(
  serverAddress: string
): Promise<SyncSnapshot> {
  const responseText = await httpGet(
    `${serverAddress}/api/sync/snapshot`,
    120_000
  );
  const data = JSON.parse(responseText) as { snapshot: SyncSnapshot };
  logger.info(
    `${TAG} snapshot fetched: ${data.snapshot.sessions.length} sessions latestSeq=${data.snapshot.latestSeq}`
  );
  return data.snapshot;
}

/**
 * 按游标增量拉取变更流。
 * @param serverAddress 服务器地址
 * @param since 客户端已持有的序号
 * @param limit 单页上限
 * @returns 按序变更与服务端最新序号
 */
export async function fetchSyncChanges(
  serverAddress: string,
  since: number,
  limit: number
): Promise<{ changes: SessionChange[]; head: number }> {
  const responseText = await httpGet(
    `${serverAddress}/api/changes?since=${since}&limit=${limit}`
  );
  return JSON.parse(responseText) as { changes: SessionChange[]; head: number };
}

/**
 * 拉当前连接主机的身份标识。
 * @param serverAddress 服务器地址
 * @returns 主机身份 hostId，同步引擎凭它识别镜像归属
 */
export async function fetchHostId(serverAddress: string): Promise<string> {
  const responseText = await httpGet(`${serverAddress}/api/handshake`);
  const data = JSON.parse(responseText) as { hostId?: string };
  if (!data.hostId) {
    throw new Error('handshake response missing hostId');
  }
  return data.hostId;
}
