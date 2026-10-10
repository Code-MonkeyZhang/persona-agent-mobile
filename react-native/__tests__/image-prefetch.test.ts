/**
 * @file __tests__/image-prefetch.test.ts
 * @description 图片排队下载器的单测，依赖全注入替身，覆盖清单拼装、
 *   失败清哨兵重试、空清单跳过、poses 请求失败降级与放弃封顶五条主路径。
 */
import {
  ImagePrefetch,
  type ImagePrefetchDeps,
} from '../src/storage/image-prefetch';
import type { AgentInfo, PoseAssets } from '../src/api/server-api';

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

/** 造一个可指定失败轮次的替身集合，哈希全部用合法十六进制 */
function makeDeps(poses: PoseAssets = { poses: [], backgroundHash: '' }) {
  const states: string[] = [];
  const resolved: string[] = [];
  const cleared: string[] = [];
  const logs: string[] = [];
  let posesError: Error | null = null;
  /** 按地址记录剩余失败次数，零表示成功 */
  let failTimes: Record<string, number> = {};

  /** 定长的合法十六进制哈希 */
  const hashOf = (prefix: string) => prefix.padEnd(64, '0');

  /** 无哈希模式模拟哈希未登记的地址，排队器应整条过滤 */
  let plainUrls = false;
  /** 全量命中模式模拟图片全部已在本地，排队器应整轮跳过 */
  let allCached = false;

  const withHash = (path: string, prefix: string) =>
    plainUrls ? `http://s${path}` : `http://s${path}?h=${hashOf(prefix)}`;

  const deps: ImagePrefetchDeps = {
    fetchPoses: async () => {
      if (posesError) throw posesError;
      return poses;
    },
    avatarUrl: (id, address) => withHash(`${address}/agents/${id}/avatar`, 'a'),
    poseUrl: (id, name, address) =>
      withHash(
        `${address}/agents/${id}/pose/${name}`,
        name === 'idle' ? '1' : '2'
      ),
    backgroundUrl: (id, address) =>
      withHash(`${address}/agents/${id}/background`, 'b'),
    peek: (u) => (allCached ? `/cached${u}` : null),
    resolve: async (u) => {
      if (failTimes[u] > 0) {
        failTimes[u]--;
        return null;
      }
      resolved.push(u);
      return `/cache${u}`;
    },
    clearFailure: (u) => cleared.push(u),
    onStateChange: (state) => states.push(state),
    log: (message) => logs.push(message),
  };

  return {
    deps,
    states,
    resolved,
    cleared,
    logs,
    avatarUrl: (id: string) =>
      `http://shttp://server/agents/${id}/avatar?h=${hashOf('a')}`,
    backgroundUrl: (id: string) =>
      `http://shttp://server/agents/${id}/background?h=${hashOf('b')}`,
    setPlainUrls: () => {
      plainUrls = true;
    },
    setAllCached: () => {
      allCached = true;
    },
    setPosesError: (e: Error | null) => {
      posesError = e;
    },
    setFailTimes: (map: Record<string, number>) => {
      failTimes = map;
    },
  };
}

/** 等排队器排空，重试间隔注入一毫秒级小值 */
async function drain(prefetch: ImagePrefetch): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 2);
    });
  }
}

function makePrefetch(deps: ImagePrefetchDeps): ImagePrefetch {
  return new ImagePrefetch(deps, { base: 1, max: 2 });
}

describe('ImagePrefetch', () => {
  it('assembles the manifest and resolves every url', async () => {
    const h = makeDeps({
      poses: [
        { name: 'idle', hash: 'x'.repeat(64) },
        { name: 'happy', hash: 'y'.repeat(64) },
      ],
      backgroundHash: 'z'.repeat(64),
    });
    const prefetch = makePrefetch(h.deps);
    prefetch.feed([agent('a1')], 'http://server');
    await drain(prefetch);

    expect(h.resolved).toHaveLength(4);
    expect(h.states).toEqual(['syncing', 'ready']);
  });

  it('retries a failed url after clearing the failure sentinel', async () => {
    const h = makeDeps();
    const avatar = h.avatarUrl('a1');
    h.setFailTimes({ [avatar]: 1 });
    const prefetch = makePrefetch(h.deps);
    prefetch.feed([agent('a1')], 'http://server');
    await drain(prefetch);

    expect(h.resolved).toContain(avatar);
    expect(h.cleared).toContain(avatar);
    expect(h.states).toEqual(['syncing', 'ready']);
  });

  it('skips the syncing state when the manifest is empty', async () => {
    const h = makeDeps();
    h.setPlainUrls();
    const prefetch = makePrefetch(h.deps);
    prefetch.feed([agent('a1')], 'http://server');
    await drain(prefetch);

    expect(h.resolved).toHaveLength(0);
    expect(h.states).toEqual(['ready']);
  });

  it('still queues the avatar when fetching poses fails', async () => {
    const h = makeDeps();
    h.setPosesError(new Error('poses down'));
    const prefetch = makePrefetch(h.deps);
    prefetch.feed([agent('a1')], 'http://server');
    await drain(prefetch);

    expect(h.resolved).toHaveLength(1);
    expect(h.logs.some((l) => l.includes('poses fetch failed'))).toBe(true);
    expect(h.states).toEqual(['syncing', 'ready']);
  });

  it('skips the whole cycle when every url is already cached', async () => {
    const h = makeDeps();
    h.setAllCached();
    const prefetch = makePrefetch(h.deps);
    prefetch.feed([agent('a1')], 'http://server');
    await drain(prefetch);

    expect(h.resolved).toHaveLength(0);
    expect(h.states).not.toContain('syncing');
    expect(h.logs.some((l) => l.includes('fully cached'))).toBe(true);
  });

  it('gives up after bounded attempts and still reports ready', async () => {
    const h = makeDeps();
    h.setFailTimes({
      [h.avatarUrl('a1')]: 99,
      [h.backgroundUrl('a1')]: 99,
    });
    const prefetch = makePrefetch(h.deps);
    prefetch.feed([agent('a1')], 'http://server');
    await drain(prefetch);

    expect(h.resolved).toHaveLength(0);
    expect(h.cleared.filter((u) => u === h.avatarUrl('a1'))).toHaveLength(2);
    expect(h.logs.some((l) => l.includes('give up'))).toBe(true);
    expect(h.states).toEqual(['syncing', 'ready']);
  });
});
