/**
 * @file __tests__/agents-sync.test.ts
 * @description agent 清单刷新器的单测，依赖全注入替身，覆盖
 *   序号护栏去重、落镜像路径、空清单跳过与失败不落脏数据四条主路径。
 */
import { AgentsSync, type AgentsSyncDeps } from '../src/storage/agents-sync';
import type { AgentInfo } from '../src/api/server-api';

function agent(id: string): AgentInfo {
  return {
    id,
    name: `agent-${id}`,
    defaultModel: { provider: 'p', model: 'm' },
    systemPrompt: 'prompt',
    maxSteps: 10,
    mcpNames: [],
    skillNames: [],
    compressionThreshold: 50,
    dreamIntervalMinutes: 120,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeDeps() {
  const puts: AgentInfo[][] = [];
  const logs: string[] = [];
  let fetched: AgentInfo[] = [agent('a1')];
  let error: Error | null = null;
  const deps: AgentsSyncDeps = {
    fetchAgents: async () => {
      if (error) throw error;
      return fetched;
    },
    putAgents: async (list) => {
      puts.push(list);
    },
    getServerAddress: () => 'http://server',
    log: (message) => logs.push(message),
  };
  return {
    deps,
    puts,
    logs,
    setFetched: (list: AgentInfo[]) => {
      fetched = list;
    },
    setError: (e: Error | null) => {
      error = e;
    },
  };
}

describe('AgentsSync', () => {
  it('refreshes agents into the mirror on success', async () => {
    const h = makeDeps();
    const sync = new AgentsSync(h.deps);
    await sync.refresh();
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0].map((a) => a.id)).toEqual(['a1']);
    expect(h.logs.some((l) => l.includes('refreshed'))).toBe(true);
  });

  it('skips fetching when no server address', async () => {
    const h = makeDeps();
    h.deps.getServerAddress = () => '';
    const sync = new AgentsSync(h.deps);
    await sync.refresh();
    expect(h.puts).toHaveLength(0);
  });

  it('skips the mirror when the list comes back empty', async () => {
    const h = makeDeps();
    h.setFetched([]);
    const sync = new AgentsSync(h.deps);
    await sync.refresh();
    expect(h.puts).toHaveLength(0);
  });

  it('keeps the mirror untouched when fetching fails', async () => {
    const h = makeDeps();
    h.setError(new Error('network down'));
    const sync = new AgentsSync(h.deps);
    await expect(sync.refresh()).resolves.toBeUndefined();
    expect(h.puts).toHaveLength(0);
    expect(h.logs.some((l) => l.includes('failed'))).toBe(true);
  });

  it('consumes invalidation seqs monotonically', () => {
    const sync = new AgentsSync(makeDeps().deps);
    expect(sync.consumeInvalidation(5)).toBe(true);
    expect(sync.consumeInvalidation(5)).toBe(false);
    expect(sync.consumeInvalidation(4)).toBe(false);
    expect(sync.consumeInvalidation(6)).toBe(true);
    expect(sync.consumeInvalidation(6)).toBe(false);
  });
});
