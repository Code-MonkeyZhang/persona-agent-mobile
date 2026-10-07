/**
 * @file storage/image-prefetch.ts
 * @description 图片资源的后台排队下载器。
 *   agent 清单到手后把全部头像、立绘、背景按内容哈希补齐到本地，
 *   缺的限并发下载，失败项清哨兵后按指数退避重试。
 *   周期开始前先查本地命中，全部已在本地的清单直接跳过且不动状态，
 *   空转不触发横幅的同步态与绿闪。
 *   对外只有 feed 一个入口，清单到手的全部时机都调它，
 *   重入时暂存最新清单，本轮排空后自动续跑。
 *   本文件只含纯逻辑，真实依赖的单例装配在 sync-setup。
 */
import { parseHashKey } from './image-cache.ts';
import type { AgentInfo, PoseAssets } from '../api/server-api';

/** 排队下载的进度，节奏对齐 mirrorStore 的三态 */
export type PrefetchState = 'idle' | 'syncing' | 'ready';

/** 排队链路的可注入依赖，测试用手写假实现替换 */
export interface ImagePrefetchDeps {
  fetchPoses: (agentId: string, address: string) => Promise<PoseAssets>;
  avatarUrl: (agentId: string, address: string) => string;
  poseUrl: (agentId: string, poseName: string, address: string) => string;
  backgroundUrl: (agentId: string, address: string) => string;
  /** 同步查本地路径，命中表示无需下载 */
  peek: (url: string) => string | null;
  resolve: (url: string) => Promise<string | null>;
  clearFailure: (url: string) => void;
  onStateChange: (state: PrefetchState) => void;
  log: (message: string) => void;
}

/** 同一时刻并行下载的图片数 */
const CONCURRENCY = 2;

/** 单轮投喂内单张图的最大尝试次数 */
const MAX_ATTEMPTS = 3;

/** 失败重试的默认起始与封顶间隔，测试注入小值加速 */
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60000;

/** 可等待的毫秒数 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 图片排队下载器 */
export class ImagePrefetch {
  private running = false;
  /** 投喂暂存，排空后续跑用最新清单 */
  private pending: { agents: AgentInfo[]; address: string } | null = null;

  constructor(
    private readonly deps: ImagePrefetchDeps,
    private readonly retryMs: { base: number; max: number } = {
      base: RETRY_BASE_MS,
      max: RETRY_MAX_MS,
    }
  ) {}

  /**
   * 投喂一份 agent 清单，重复投喂只保留最新一份。
   * 排空或放弃后置 ready，横幅据此解除同步态。
   */
  feed(agents: AgentInfo[], serverAddress: string): void {
    if (!serverAddress) {
      return;
    }
    this.pending = { agents, address: serverAddress };
    if (this.running) {
      return;
    }
    this.drain();
  }

  /** 逐份消化暂存的清单，全部排空后置 ready */
  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        await this.runCycle(job.agents, job.address);
      }
    } finally {
      this.running = false;
      this.deps.onStateChange('ready');
    }
  }

  /** 单份清单的完整周期，拼清单、预检、下载、重试 */
  private async runCycle(agents: AgentInfo[], address: string): Promise<void> {
    const urls = [...new Set(await this.collectUrls(agents, address))].filter(
      (url) => parseHashKey(url)
    );
    if (urls.length === 0) {
      this.deps.log('manifest empty, skip cycle');
      return;
    }
    // 全部命中本地的清单直接跳过，不动状态避免空转触发绿闪
    const missing = urls.filter((url) => !this.deps.peek(url));
    if (missing.length === 0) {
      this.deps.log(`manifest fully cached: ${urls.length} urls, skip cycle`);
      return;
    }
    this.deps.onStateChange('syncing');
    this.deps.log(
      `manifest ready: ${urls.length} urls, ${missing.length} missing`
    );

    let failed = missing;
    let delay = this.retryMs.base;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        this.deps.log(
          `retry ${failed.length} urls after ${delay}ms, attempt=${attempt}`
        );
        await sleep(delay);
        delay = Math.min(delay * 2, this.retryMs.max);
        for (const url of failed) {
          this.deps.clearFailure(url);
        }
      }
      failed = await this.runPool(failed);
      if (failed.length === 0) {
        this.deps.log('manifest drained');
        return;
      }
    }
    this.deps.log(
      `give up ${failed.length} urls after ${MAX_ATTEMPTS} attempts`
    );
  }

  /** 拼装下载清单，头像来自清单自身，立绘背景逐 agent 补一次请求 */
  private async collectUrls(
    agents: AgentInfo[],
    address: string
  ): Promise<string[]> {
    const urls: string[] = [];
    for (const agent of agents) {
      urls.push(this.deps.avatarUrl(agent.id, address));
      try {
        const assets = await this.deps.fetchPoses(agent.id, address);
        for (const pose of assets.poses) {
          urls.push(this.deps.poseUrl(agent.id, pose.name, address));
        }
        urls.push(this.deps.backgroundUrl(agent.id, address));
      } catch (e) {
        this.deps.log(
          `poses fetch failed agent=${agent.id}: ${
            e instanceof Error ? e.message : e
          }`
        );
      }
    }
    return urls;
  }

  /** 固定并发跑一轮，返回失败地址集 */
  private async runPool(urls: string[]): Promise<string[]> {
    const failed: string[] = [];
    let index = 0;
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, urls.length) },
      async () => {
        while (index < urls.length) {
          const url = urls[index++];
          const path = await this.deps.resolve(url);
          if (!path) {
            failed.push(url);
          }
        }
      }
    );
    await Promise.all(workers);
    return failed;
  }
}
