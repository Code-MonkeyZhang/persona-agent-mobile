/**
 * @file stores/toolsStore.ts
 * @description 工具注册表清单的共享状态，形状照桌面端 mcpStore 的工具切片。
 *   loadTools 带 agentId 拉清单，条目自带 assigned 标记，默认规则只在服务端算，
 *   次序护栏只放行最新一次响应，在途写径的乐观值补丁到落地清单上；
 *   setAssignment 是内置开关与外部加减号共用的唯一写径，点击先本地乐观翻转，
 *   写径按条目单飞，成功与失败都整份重拉对账，服务端永远是真相来源；
 *   toggleAssignment 是三个界面入口共用的切换语义，目标态只在 store 一处计算，
 *   调用那一刻读最新清单态取反，界面不再各自手写反转逻辑；
 *   tools_invalidated 事件经序号护栏触发重拉，lastAgentId 供事件重拉复用。
 *   手机端对连接动作只读，授权与重连都在桌面端完成，这里不持有动作态。
 */
import { create } from 'zustand';
import { Alert } from 'react-native';
import i18n from '../i18n/index.ts';
import {
  assignTool,
  listTools,
  type ToolEntryInfo,
} from '../api/server-api.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';
import { LoadGuard } from '../lib/loadGuard';

const TAG = '[ToolsStore]';

/** 请求语言参数，英文界面取英文文案，其余交给服务端按中文基底 */
function requestLang(): 'zh' | 'en' {
  return i18n.language.startsWith('zh') ? 'zh' : 'en';
}

/**
 * 在途乐观值补丁到落地清单上。
 * 写径未完成前，先出发的旧快照可能晚到，乐观值比它新，落地时按条目覆盖回去。
 */
function patchPending(
  tools: ToolEntryInfo[],
  assigning: Map<string, boolean>
): ToolEntryInfo[] {
  if (assigning.size === 0) {
    return tools;
  }
  return tools.map((entry) => {
    const pending = assigning.get(entry.id);
    return pending === undefined ? entry : { ...entry, assigned: pending };
  });
}

interface ToolsState {
  /** 注册表条目清单，null 表示尚未拉取过 */
  entries: ToolEntryInfo[] | null;
  entriesError: string | null;
  /** 最近一次拉清单的 agentId，事件重拉复用 */
  lastAgentId: string | undefined;
  /** 写分配在途的条目，键为条目 id 值为乐观 assigned 值，界面读它锁开关 */
  assigning: Map<string, boolean>;
  loadTools: (agentId?: string) => Promise<void>;
  setAssignment: (
    agentId: string,
    entryId: string,
    assigned: boolean
  ) => Promise<void>;
  /** 切换一条分配记录，调用那一刻读清单态取反，界面入口只传条目 id */
  toggleAssignment: (entryId: string) => Promise<void>;
  /** 消费一条 tools_invalidated 事件，序号不前进时跳过，前进时按 lastAgentId 重拉 */
  consumeInvalidation: (seq: number) => void;
}

/** loadTools 的响应次序护栏，过期响应整段丢弃，留在模块层 */
const loadGuard = new LoadGuard();

/** 序号护栏的最近已消费事件序号，界面不读，留在模块层 */
let lastInvalidatedSeq = 0;

export const useToolsStore = create<ToolsState>((set, get) => ({
  entries: null,
  entriesError: null,
  lastAgentId: undefined,
  assigning: new Map(),

  loadTools: async (agentId) => {
    const address = getServerAddress();
    const target = agentId ?? getServerAgentId();
    if (!address || !target) {
      return;
    }
    const ticket = loadGuard.begin();
    set({ entriesError: null, lastAgentId: target });
    try {
      const tools = await listTools(address, target, requestLang());
      if (!loadGuard.isCurrent(ticket)) {
        logger.info(`${TAG} loadTools dropped a stale response`);
        return;
      }
      set({ entries: patchPending(tools, get().assigning) });
    } catch (e) {
      if (!loadGuard.isCurrent(ticket)) {
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`${TAG} loadTools failed: ${message}`);
      set({ entriesError: message });
    }
  },

  setAssignment: async (agentId, entryId, assigned) => {
    if (get().assigning.has(entryId)) {
      return;
    }
    const address = getServerAddress();
    if (!address) {
      return;
    }
    logger.info(`${TAG} assign ${entryId} ${assigned ? 'on' : 'off'}`);
    set((state) => {
      const assigning = new Map(state.assigning).set(entryId, assigned);
      if (!state.entries) {
        return { assigning };
      }
      return {
        assigning,
        entries: state.entries.map((entry) =>
          entry.id === entryId ? { ...entry, assigned } : entry
        ),
      };
    });
    try {
      await assignTool(address, agentId, entryId, assigned);
    } catch (e) {
      logger.warn(
        `${TAG} assign ${entryId} failed: ${e instanceof Error ? e.message : e}`
      );
      Alert.alert(
        i18n.t('nav.assignFailedTitle'),
        i18n.t('nav.assignFailedMsg')
      );
      // 失败先撤乐观标记，随后的重拉才能带回未打补丁的真相
      set((state) => {
        const next = new Map(state.assigning);
        next.delete(entryId);
        return { assigning: next };
      });
    }
    // 成功对账失败回真相，都整份重拉
    await get().loadTools(agentId);
    set((state) => {
      const next = new Map(state.assigning);
      next.delete(entryId);
      return { assigning: next };
    });
  },

  toggleAssignment: async (entryId) => {
    const entry = get().entries?.find((e) => e.id === entryId);
    if (!entry) {
      logger.warn(`${TAG} toggle skipped, entry not found: ${entryId}`);
      return;
    }
    const agentId = get().lastAgentId ?? getServerAgentId();
    if (!agentId) {
      return;
    }
    await get().setAssignment(agentId, entryId, entry.assigned !== true);
  },

  consumeInvalidation: (seq) => {
    if (seq <= lastInvalidatedSeq) {
      return;
    }
    lastInvalidatedSeq = seq;
    const agentId = get().lastAgentId;
    logger.info(
      `${TAG} invalidated, seq=${seq}, reload agent=${agentId ?? 'none'}`
    );
    if (agentId) {
      get().loadTools(agentId);
    }
  },
}));
