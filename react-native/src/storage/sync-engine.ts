/**
 * @file storage/sync-engine.ts
 * @description 会话同步引擎，照搬桌面端实现。
 *   缓存库与服务端正本之间的单向追平器。冷启动游标为零先拉快照整体入库，
 *   之后分页拉变更流到服务端最新序号，推送模式下按序回放 WS 推来的单条变更。
 *   断线重连后重新走一遍追平。全部操作进同一条串行队列，
 *   追平的分页批次与推送的单条变更不会交错，游标始终单调前进。
 *   追平失败按指数退避自动重试，连接保持不断也能自愈。
 */

import type { SessionChange, SyncSnapshot } from './sync-shapes.ts';

/** 引擎的外部依赖，全部注入便于单测 */
export interface SyncDeps {
  /** 拉全量快照 */
  fetchSnapshot: () => Promise<SyncSnapshot>;
  /** 按游标分页拉变更，返回按序变更与服务端最新序号 */
  fetchChanges: (
    since: number,
    limit: number
  ) => Promise<{ changes: SessionChange[]; head: number }>;
  /** 读本地缓存游标 */
  getCursor: () => Promise<number>;
  /** 快照整体入库 */
  applySnapshot: (snapshot: SyncSnapshot) => Promise<void>;
  /** 变更批量回放入库 */
  applyChanges: (changes: SessionChange[]) => Promise<void>;
  /** 结构化日志 */
  log: (message: string) => void;
  /** 追平开始回调，携带刚读到的游标，供界面侧识别首次全量同步 */
  onCatchUpStart?: (cursor: number) => void;
  /** 追平成功回调，供界面侧置位首次同步完成状态 */
  onCatchUpSuccess?: () => void;
}

/** 追平分页上限 */
const PAGE_LIMIT = 500;

/** 追平失败重试的起步间隔毫秒数 */
const RETRY_BASE_MS = 5000;

/** 追平失败重试的间隔上限毫秒数 */
const RETRY_MAX_MS = 60000;

/** 会话同步引擎，依赖全注入的纯 TS 模块 */
export class SyncEngine {
  private queue: Promise<void> = Promise.resolve();
  /** 等待执行的重试定时器，新的显式追平会将其取消 */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 下一次重试的间隔毫秒数，失败后翻倍封顶 */
  private retryDelayMs: number;

  constructor(
    private readonly deps: SyncDeps,
    private readonly retryMs: { base: number; max: number } = {
      base: RETRY_BASE_MS,
      max: RETRY_MAX_MS,
    }
  ) {
    this.retryDelayMs = this.retryMs.base;
  }

  /** 追平到服务端最新，连接建立与重连时调用，取代任何等待中的重试 */
  sync(): void {
    this.clearRetryTimer();
    this.retryDelayMs = this.retryMs.base;
    this.enqueue(
      () => this.catchUp(),
      () => this.scheduleRetry()
    );
  }

  /** 回放推送来的单条变更 */
  onChange(change: SessionChange): void {
    this.enqueue(() => this.deps.applyChanges([change]));
  }

  /**
   * 串行队列，前一项失败不阻断后一项。
   * 队列本身吞掉错误并落日志，调用方无需感知失败，
   * onReject 在日志之后回调，供调用方安排失败后的动作。
   */
  private enqueue(
    work: () => Promise<void>,
    onReject?: () => void
  ): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await work();
      } catch (error) {
        this.deps.log(
          `Sync failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        onReject?.();
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /** 追平主流程：先镜像再分页拉平 */
  private async catchUp(): Promise<void> {
    let cursor = await this.deps.getCursor();
    this.deps.onCatchUpStart?.(cursor);

    if (cursor === 0) {
      const snapshot = await this.deps.fetchSnapshot();
      await this.deps.applySnapshot(snapshot);
      cursor = snapshot.latestSeq;
      this.deps.log(
        `Mirrored snapshot: ${snapshot.sessions.length} sessions latestSeq=${cursor}`
      );
    }

    for (;;) {
      const { changes, head } = await this.deps.fetchChanges(
        cursor,
        PAGE_LIMIT
      );
      if (changes.length === 0) break;
      await this.deps.applyChanges(changes);
      cursor = changes[changes.length - 1].seq;
      if (head <= cursor) break;
    }
    this.deps.onCatchUpSuccess?.();
  }

  /**
   * 追平失败后安排指数退避重试。
   * 重试经串行队列入队，与推送回放不会交错，间隔每次翻倍封顶。
   */
  private scheduleRetry(): void {
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, this.retryMs.max);
    this.deps.log(`Sync retry scheduled in ${delay}ms`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.enqueue(
        () => this.catchUp(),
        () => this.scheduleRetry()
      );
    }, delay);
  }

  /** 取消等待中的重试定时器，显式追平启动时调用 */
  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.deps.log('Sync retry cancelled by new sync');
    }
  }
}
