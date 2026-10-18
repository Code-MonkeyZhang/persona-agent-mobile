/**
 * @file cacheDbHost.test.ts
 * @description 镜像库按主机分区的直测，假 op-sqlite 与假 RNFS，
 *   覆盖未指派空读、切换开关库、删除活动库、存量迁移改名与无章删除。
 */
import { open, type DB } from '@op-engineering/op-sqlite';
import RNFS from 'react-native-fs';
import { CacheDb } from '../src/storage/cache-db';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/docs',
  mkdir: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  unlink: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  exists: jest.fn(() => Promise.resolve(true)),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve() })),
}));

/** 假库对象，记录名字与开关节点，kv 查询按注入的章表回答 */
class FakeDb {
  closed = false;
  deleted = false;
  constructor(
    readonly name: string,
    private readonly stamps: Record<string, string>
  ) {}
  executeSync(): void {}
  async execute(query: string): Promise<{ rows: unknown[] }> {
    if (query.includes('SELECT value FROM kv')) {
      const stamp = this.stamps[this.name];
      return stamp ? { rows: [{ value: stamp }] } : { rows: [] };
    }
    return { rows: [] };
  }
  async executeBatch(): Promise<void> {}
  async transaction(): Promise<void> {}
  close(): void {
    this.closed = true;
  }
  delete(): void {
    this.deleted = true;
  }
  getDbPath(): string {
    return `/docs/${this.name}`;
  }
}

const openedDbs: FakeDb[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  openedDbs.length = 0;
  const stamps: Record<string, string> = {};
  (open as unknown as jest.Mock).mockImplementation(
    ({ name }: { name: string }) => {
      const db = new FakeDb(name, stamps);
      openedDbs.push(db);
      return db as unknown as DB;
    }
  );
});

const dbNamed = (name: string): FakeDb =>
  openedDbs.find((db) => db.name === name)!;

describe('镜像库按主机分区', () => {
  it('未指派主机时读路径一律返回空', async () => {
    const cacheDb = new CacheDb();
    expect(await cacheDb.getCursor()).toBe(0);
    expect(await cacheDb.getSourceHostId()).toBeNull();
    expect(await cacheDb.listAgents()).toEqual([]);
    expect(await cacheDb.getSession('s1')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('切换主机后读写落在新库文件，旧库关闭', async () => {
    const cacheDb = new CacheDb();
    await cacheDb.switchHost('host-a');
    await cacheDb.listAgents();
    expect(dbNamed('persona-cache-host-a')).toBeDefined();

    await cacheDb.switchHost('host-b');
    await cacheDb.listAgents();
    expect(dbNamed('persona-cache-host-a').closed).toBe(true);
    expect(dbNamed('persona-cache-host-b').closed).toBe(false);
  });

  it('重复切换同一主机不重开库', async () => {
    const cacheDb = new CacheDb();
    await cacheDb.switchHost('host-a');
    await cacheDb.listAgents();
    await cacheDb.switchHost('host-a');
    expect(
      openedDbs.filter((db) => db.name === 'persona-cache-host-a')
    ).toHaveLength(1);
  });

  it('删除活动主机的库时先关库再删文件', async () => {
    const cacheDb = new CacheDb();
    await cacheDb.switchHost('host-a');
    await cacheDb.listAgents();

    await cacheDb.deleteHostDb('host-a');
    const dbs = openedDbs.filter((db) => db.name === 'persona-cache-host-a');
    // 活动句柄被关掉，文件层面经重新打开的句柄删除
    expect(dbs.some((db) => db.closed)).toBe(true);
    expect(dbs.some((db) => db.deleted)).toBe(true);
    expect(await cacheDb.listAgents()).toEqual([]);
  });

  it('存量单库有身份章时改名为分区库并返回 hostId', async () => {
    (open as unknown as jest.Mock).mockImplementation(
      ({ name }: { name: string }) => {
        const stamps: Record<string, string> = { 'persona-cache': 'host-a' };
        const db = new FakeDb(name, stamps);
        openedDbs.push(db);
        return db as unknown as DB;
      }
    );
    const cacheDb = new CacheDb();

    const hostId = await cacheDb.migrateLegacy();
    expect(hostId).toBe('host-a');
    expect(RNFS.moveFile).toHaveBeenCalledWith(
      '/docs/persona-cache',
      '/docs/persona-cache-host-a'
    );
  });

  it('存量单库无身份章时删除并返回 null', async () => {
    const cacheDb = new CacheDb();

    const hostId = await cacheDb.migrateLegacy();
    expect(hostId).toBeNull();
    expect(dbNamed('persona-cache').deleted).toBe(true);
  });
});
