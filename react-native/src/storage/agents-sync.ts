/**
 * @file storage/agents-sync.ts
 * @description agent 清单的统一网络刷新器。
 *   连接触发、焦点刷新与 agents_invalidated 事件都走 refresh，
 *   拉取成功落镜像，镜像写后通知驱动界面重读，界面层不直接持有网络结果。
 *   consumeInvalidation 用序号护栏拦掉 WS 推送与变更拉取
 *   双路交付的同一条失效事件，避免重复刷新。
 *   本文件只含纯逻辑，真实依赖的单例装配在 sync-setup。
 */
import type { AgentInfo } from '../api/server-api';

/** 刷新链路的可注入依赖，测试用手写假实现替换 */
export interface AgentsSyncDeps {
  fetchAgents: (address: string) => Promise<AgentInfo[]>;
  putAgents: (agents: AgentInfo[]) => Promise<void>;
  getServerAddress: () => string;
  /** 清单落镜像后的回调，图片排队下载挂在这里 */
  onRefreshed?: (agents: AgentInfo[]) => void;
  log: (message: string) => void;
}

/** agent 清单刷新器，序号护栏与网络刷新封装在一起 */
export class AgentsSync {
  /** 最近一次已消费的失效事件序号 */
  private lastInvalidatedSeq = 0;

  constructor(private readonly deps: AgentsSyncDeps) {}

  /**
   * 消费一条失效事件，序号不前进时跳过。
   * 返回 true 表示这条事件此前未被消费，调用方需要刷新。
   */
  consumeInvalidation(seq: number): boolean {
    if (seq <= this.lastInvalidatedSeq) {
      return false;
    }
    this.lastInvalidatedSeq = seq;
    return true;
  }

  /** 拉取最新 agent 清单并落镜像，失败只留日志不动镜像 */
  async refresh(): Promise<void> {
    const address = this.deps.getServerAddress();
    if (!address) {
      return;
    }
    try {
      const agents = await this.deps.fetchAgents(address);
      if (agents.length === 0) {
        return;
      }
      await this.deps.putAgents(agents);
      this.deps.onRefreshed?.(agents);
      this.deps.log(`agents refreshed: ${agents.length}`);
    } catch (e) {
      this.deps.log(`refresh failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
