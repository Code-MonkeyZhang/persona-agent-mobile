/**
 * @file __tests__/sync-engine.test.ts
 * @description 同步引擎的单测，依赖全注入替身，覆盖快照追平、分页拉平、
 *   推送回放、串行排队、失败不阻断与退避重试六条主路径。
 */
import { SyncEngine, type SyncDeps } from '../src/storage/sync-engine';
import type { SessionChange, SyncSnapshot } from '../src/storage/sync-shapes';

function snapshot(latestSeq: number): SyncSnapshot {
  return {
    latestSeq,
    agents: [],
    sessions: [
      {
        id: 'chat-a',
        agentId: 'a',
        title: '聊天',
        createdAt: 1,
        updatedAt: 1,
        model: { provider: 'p', model: 'm' },
        messages: [
          { seq: 1, message: { role: 'user', content: 'hi' }, createdAt: 1 },
        ],
      },
    ],
  };
}

function change(
  seq: number,
  kind: SessionChange['kind'] = 'turn_end'
): SessionChange {
  return { seq, kind, sessionId: 'chat-a', data: {}, createdAt: seq };
}

function makeDeps() {
  const applied: number[][] = [];
  const snapshots: number[] = [];
  const logs: string[] = [];
  let changesBySince: Record<
    number,
    { changes: SessionChange[]; head: number }
  > = {};
  const deps: SyncDeps = {
    fetchSnapshot: async () => {
      snapshots.push(1);
      return snapshot(10);
    },
    fetchChanges: async (since) =>
      changesBySince[since] ?? { changes: [], head: 0 },
    getCursor: async () => (snapshots.length > 0 ? 10 : 0),
    applySnapshot: async (snap) => {
      snapshots.push(snap.latestSeq);
    },
    applyChanges: async (list) => {
      applied.push(list.map((c) => c.seq));
    },
    log: (message) => logs.push(message),
  };
  return {
    deps,
    applied,
    snapshots,
    logs,
    setChanges: (map: typeof changesBySince) => {
      changesBySince = map;
    },
  };
}

/** 等到队列里的微任务全部跑完 */
async function drain(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
}

test('冷启动游标为零先拉快照再确认追平', async () => {
  const { deps, applied, snapshots } = makeDeps();
  const engine = new SyncEngine(deps);
  engine.sync();
  await drain();
  expect(snapshots.length).toBe(2);
  expect(applied).toEqual([]);
});

test('快照之后有缺口时分页拉平到最新序号', async () => {
  const { deps, applied, setChanges } = makeDeps();
  const pageOne = Array.from({ length: 2 }, (_, i) => change(11 + i));
  const pageTwo = [change(13)];
  setChanges({
    10: { changes: pageOne, head: 13 },
    12: { changes: pageTwo, head: 13 },
  });
  const engine = new SyncEngine(deps);
  engine.sync();
  await drain();
  expect(applied).toEqual([[11, 12], [13]]);
});

test('推送的单条变更进串行队列回放', async () => {
  const { deps, applied } = makeDeps();
  const engine = new SyncEngine(deps);
  engine.onChange(change(11));
  engine.onChange(change(12));
  await drain();
  expect(applied).toEqual([[11], [12]]);
});

test('追平与推送不会交错，推送排在追平之后', async () => {
  const { deps, applied } = makeDeps();
  const order: string[] = [];
  const tracking: SyncDeps = {
    ...deps,
    applySnapshot: async (snap) => {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
      order.push('snapshot');
      return deps.applySnapshot(snap);
    },
    applyChanges: async (list) => {
      order.push(`changes:${list[0]?.seq ?? 'none'}`);
      return deps.applyChanges(list);
    },
  };
  const engine = new SyncEngine(tracking);
  engine.sync();
  engine.onChange(change(11));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
  expect(order[0]).toBe('snapshot');
  expect(order[order.length - 1]).toBe('changes:11');
  expect(applied).toEqual([[11]]);
});

test('前一项失败不阻断后一项，失败进日志', async () => {
  const { deps, applied, logs } = makeDeps();
  let failOnce = true;
  const flaky: SyncDeps = {
    ...deps,
    applyChanges: async (list) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('boom');
      }
      return deps.applyChanges(list);
    },
  };
  const engine = new SyncEngine(flaky);
  engine.onChange(change(11));
  await drain();
  engine.onChange(change(12));
  await drain();
  expect(logs.some((line) => line.includes('boom'))).toBe(true);
  expect(applied).toEqual([[12]]);
});

test('追平失败后按退避间隔重试，成功后不再重试', async () => {
  const { deps, snapshots, logs } = makeDeps();
  let failed = false;
  let fetches = 0;
  const flaky: SyncDeps = {
    ...deps,
    fetchSnapshot: async () => {
      fetches += 1;
      if (!failed) {
        failed = true;
        throw new Error('tunnel down');
      }
      return deps.fetchSnapshot();
    },
  };
  const engine = new SyncEngine(flaky, { base: 10, max: 20 });
  engine.sync();
  await drain();
  expect(fetches).toBe(1);
  expect(logs.some((line) => line.includes('tunnel down'))).toBe(true);
  expect(
    logs.some((line) => line.includes('Sync retry scheduled in 10ms'))
  ).toBe(true);
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  expect(fetches).toBe(2);
  expect(snapshots.length).toBe(2);
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  expect(fetches).toBe(2);
});

test('新的显式追平取代等待中的重试', async () => {
  const { deps, logs } = makeDeps();
  let attempts = 0;
  const counting: SyncDeps = {
    ...deps,
    fetchSnapshot: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('down');
      }
      return deps.fetchSnapshot();
    },
  };
  const engine = new SyncEngine(counting, { base: 60, max: 120 });
  engine.sync();
  await drain();
  engine.sync();
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  expect(attempts).toBe(2);
  expect(logs.some((line) => line.includes('cancelled'))).toBe(true);
});

test('追平回调携带游标并触发成功信号，界面侧据此驱动同步态', async () => {
  const { deps } = makeDeps();
  let calls = 0;
  const starts: number[] = [];
  const engine = new SyncEngine({
    ...deps,
    onCatchUpStart: (cursor) => starts.push(cursor),
    onCatchUpSuccess: () => {
      calls += 1;
    },
  });
  engine.sync();
  await drain();
  expect(calls).toBe(1);
  expect(starts).toEqual([0]);
});
