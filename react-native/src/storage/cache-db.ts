/**
 * @file storage/cache-db.ts
 * @description 移动端本地镜像库，服务端正本的只读镜像。
 *   按主机分区，每台主机一个库文件 persona-cache-<hostId>，切换主机即换活动库文件，
 *   未指派主机时读路径一律返回空，镜像来源身份与当前主机不符的自愈由同步引擎兜底。
 *   op-sqlite 开库，schema 与桌面端同构四张表，读接口产出与 HTTP 接口同形的数据。
 *   全部查询走 execute 异步版本在后台线程执行，不占 JS 线程。
 *   写入口只收快照与变更流两类服务端事实，外加 agent 列表的离线副本。
 *   全部写操作串行走模块内的写队列，调用方无需关心与同步引擎的交错。
 */
import { open, type DB, type QueryResult } from '@op-engineering/op-sqlite';
import RNFS from 'react-native-fs';
import type { AgentInfo } from '../api/server-api.ts';
import { logger } from '../lib/logger';
import {
  deriveSessionPreview,
  mixTurnEnds,
  type Message,
  type MirrorSession,
  type SessionChange,
  type SessionMeta,
  type SyncSnapshot,
} from './sync-shapes.ts';

const TAG = '[CacheDb]';

/** 分区库文件名前缀，后接 hostId */
const DB_NAME_PREFIX = 'persona-cache-';

/** 分区前的旧单库文件名，仅存量迁移时使用 */
const LEGACY_DB_NAME = 'persona-cache';

/** 缓存 kv 里的变更流游标键 */
const CURSOR_KEY = 'sync_cursor';

/** 缓存 kv 里的镜像来源主机键，与桌面端 cache-db 同名同义 */
const SOURCE_HOST_KEY = 'source_host_id';

/** 快照装载的 executeBatch 分块上限，万级消息分批提交避免单次载荷过大 */
const SNAPSHOT_CHUNK = 1000;

/** 缓存里会话行的 meta 载荷，SessionMeta 全量外加 turnEnds 边界快照 */
type SessionBlob = SessionMeta & { turnEnds?: number[] };

/** message_appended 载荷，seq 为消息行号 */
interface MessageAppendedData {
  seq: number;
  message: Message;
  createdAt?: number;
}

/** session_created 与 session_updated 载荷，meta 全量外加派生戳与边界快照 */
type SessionUpdatedData = SessionMeta & {
  turnEnds?: number[];
  lastContextAt?: number;
  lastMessageAt?: number;
};

/** 建表语句序列，与桌面端 cache-db 的 schema 同构 */
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    meta TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_agent
    ON sessions (agent_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages (session_id, seq)`,
];

export class CacheDb {
  private db: DB | null = null;
  /** 活动库对应的主机身份，null 表示尚未指派，读路径返回空 */
  private hostId: string | null = null;
  /** 写操作串行队列，putAgents 与引擎的快照装载不会在事务上交错 */
  private writeQueue: Promise<unknown> = Promise.resolve();
  /** 写操作完成后的通知回调，界面层订阅后重读镜像 */
  private readonly listeners = new Set<() => void>();

  /** 按主机身份算分区库文件名 */
  private dbNameFor(hostId: string): string {
    return DB_NAME_PREFIX + hostId;
  }

  /**
   * 开库并建表，WAL 模式让读写互不阻塞。
   * PRAGMA 与建表走 executeSync，仅首个调用承担，保证排队的异步查询执行前表已就绪。
   */
  private openDb(name: string): DB {
    const db = open({ name });
    db.executeSync('PRAGMA journal_mode = WAL');
    for (const sql of DDL) {
      db.executeSync(sql);
    }
    return db;
  }

  /** 惰性取活动库，未指派主机视为编程错误，读路径不应走到这里 */
  private ensureDb(): DB {
    if (!this.db) {
      if (!this.hostId) {
        throw new Error('mirror db has no host assigned');
      }
      this.db = this.openDb(this.dbNameFor(this.hostId));
      logger.info(`${TAG} opened mirror for ${this.hostId}`);
    }
    return this.db;
  }

  /**
   * 切换活动镜像库到目标主机。
   * 走写队列冲净在途写，先开新库再关旧库，开新失败时旧库原样保留。
   */
  switchHost(hostId: string): Promise<void> {
    return this.enqueueWrite(async () => {
      if (this.hostId === hostId && this.db) {
        return;
      }
      const next = this.openDb(this.dbNameFor(hostId));
      if (this.db) {
        this.db.close();
      }
      this.db = next;
      this.hostId = hostId;
      logger.info(`${TAG} mirror switched to ${hostId}`);
    });
  }

  /** 回到未指派主机的空态，关库不删文件，镜像数据的去留由调用方决定 */
  private switchIdle(): Promise<void> {
    return this.enqueueWrite(async () => {
      if (this.db) {
        this.db.close();
      }
      this.db = null;
      this.hostId = null;
    });
  }

  /** 删除目标主机的镜像库文件，删的是活动库时先回到未指派态 */
  async deleteHostDb(hostId: string): Promise<void> {
    if (this.hostId === hostId) {
      await this.switchIdle();
    }
    const db = this.openDb(this.dbNameFor(hostId));
    const path = db.getDbPath();
    db.close();
    try {
      db.delete();
    } catch (e) {
      // 原生删除接口不可用时退回文件系统按路径清理
      for (const suffix of ['', '-wal', '-shm']) {
        await RNFS.unlink(path + suffix).catch(() => undefined);
      }
      logger.warn(`${TAG} db.delete failed, removed by path: ${e}`);
    }
    logger.info(`${TAG} mirror deleted for ${hostId}`);
  }

  /**
   * 存量单库一次性迁移到按主机分区。
   * 读旧库的身份章，有章把库文件连同 wal 与 shm 改名到该主机的分区名并返回 hostId，
   * 无章说明镜像无从归属，删除旧文件返回 null。
   */
  async migrateLegacy(): Promise<string | null> {
    const legacy = this.openDb(LEGACY_DB_NAME);
    let hostId: string | null = null;
    try {
      const result = await legacy.execute(
        'SELECT value FROM kv WHERE key = ?',
        [SOURCE_HOST_KEY]
      );
      const row = result.rows[0] as { value: string } | undefined;
      hostId = row?.value ?? null;
    } finally {
      legacy.close();
    }
    const from = legacy.getDbPath();
    if (!hostId) {
      try {
        legacy.delete();
      } catch {
        await RNFS.unlink(from).catch(() => undefined);
      }
      logger.info(`${TAG} legacy mirror unstamped, dropped`);
      return null;
    }
    const to = from.replace(
      new RegExp(`${LEGACY_DB_NAME}(\\.db)?$`),
      `${this.dbNameFor(hostId)}$1`
    );
    for (const suffix of ['', '-wal', '-shm']) {
      if (await RNFS.exists(from + suffix)) {
        await RNFS.moveFile(from + suffix, to + suffix);
      }
    }
    logger.info(`${TAG} legacy mirror migrated to ${hostId}`);
    return hostId;
  }

  /** 订阅写后通知，返回退订函数 */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** 把写操作挂进串行队列，失败不阻断后续排队项 */
  private enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => work();
    const result = this.writeQueue.then(run, run);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }

  /** 当前变更流游标，零表示尚未镜像 */
  async getCursor(): Promise<number> {
    if (!this.hostId) {
      return 0;
    }
    const result = await this.ensureDb().execute(
      'SELECT value FROM kv WHERE key = ?',
      [CURSOR_KEY]
    );
    const row = result.rows[0] as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  private async setCursor(value: number): Promise<void> {
    await this.ensureDb().execute(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [CURSOR_KEY, String(value)]
    );
  }

  /** 镜像来源主机的身份，未记录返回 null，同步引擎凭它识别换主机 */
  async getSourceHostId(): Promise<string | null> {
    if (!this.hostId) {
      return null;
    }
    const result = await this.ensureDb().execute(
      'SELECT value FROM kv WHERE key = ?',
      [SOURCE_HOST_KEY]
    );
    const row = result.rows[0] as { value: string } | undefined;
    return row ? row.value : null;
  }

  /** 记录镜像来源主机的身份 */
  async setSourceHostId(hostId: string): Promise<void> {
    await this.enqueueWrite(() =>
      this.ensureDb().execute(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [SOURCE_HOST_KEY, hostId]
      )
    );
  }

  /** 游标归零作废镜像，同步引擎随后走快照路径整库重建 */
  async resetCursor(): Promise<void> {
    await this.enqueueWrite(() => this.setCursor(0));
  }

  /** 全量快照整体入库，先清空再分块装载，游标推进到快照序号 */
  applySnapshot(snapshot: SyncSnapshot): Promise<void> {
    return this.enqueueWrite(async () => {
      const startedAt = Date.now();
      const db = this.ensureDb();
      await db.execute('DELETE FROM messages');
      await db.execute('DELETE FROM sessions');
      // 老服务端的快照可能不带 agents 载荷，缺失时按空清单处理
      await this.replaceAgents(db, snapshot.agents ?? []);
      const tuples: Array<[string, (string | number)[]]> = [];
      let messageCount = 0;
      for (const session of snapshot.sessions) {
        const { messages, ...rest } = session;
        tuples.push([
          'INSERT INTO sessions (id, agent_id, updated_at, meta) VALUES (?, ?, ?, ?)',
          [
            session.id,
            session.agentId,
            session.updatedAt,
            JSON.stringify(rest),
          ],
        ]);
        for (const m of messages) {
          tuples.push([
            'INSERT INTO messages (seq, session_id, role, created_at, data) VALUES (?, ?, ?, ?, ?)',
            [
              m.seq,
              session.id,
              m.message.role,
              m.createdAt,
              JSON.stringify(m.message),
            ],
          ]);
          messageCount++;
        }
      }
      for (let i = 0; i < tuples.length; i += SNAPSHOT_CHUNK) {
        await db.executeBatch(tuples.slice(i, i + SNAPSHOT_CHUNK));
      }
      await this.setCursor(snapshot.latestSeq);
      logger.info(
        `${TAG} snapshot applied: ${
          snapshot.sessions.length
        } sessions ${messageCount} messages latestSeq=${
          snapshot.latestSeq
        } took=${Date.now() - startedAt}ms`
      );
      this.notify();
    });
  }

  /** 按序回放变更流，游标之前的事件跳过，消息按行号幂等 */
  applyChanges(changes: SessionChange[]): Promise<void> {
    return this.enqueueWrite(async () => {
      const startedAt = Date.now();
      const db = this.ensureDb();
      let cursor = await this.getCursor();
      let applied = 0;
      await db.transaction(async (tx) => {
        for (const change of changes) {
          if (change.seq <= cursor) {
            continue;
          }
          await this.applyChange(tx.execute.bind(tx), change);
          cursor = change.seq;
          applied++;
        }
        if (applied > 0) {
          await this.setCursor(cursor);
        }
      });
      if (applied > 0) {
        logger.info(
          `${TAG} applied ${applied} changes, cursor=${cursor} took=${
            Date.now() - startedAt
          }ms`
        );
        this.notify();
      }
    });
  }

  /** 回放单个变更事件，载荷缺失时记日志跳过 */
  private async applyChange(
    execute: (
      query: string,
      params?: Array<string | number | null>
    ) => Promise<QueryResult>,
    change: SessionChange
  ): Promise<void> {
    const sessionId = change.sessionId;
    switch (change.kind) {
      case 'session_created':
      case 'session_updated': {
        if (!sessionId) return;
        const payload = change.data as SessionUpdatedData;
        const blob: Record<string, unknown> = { ...payload };
        delete blob.lastContextAt;
        delete blob.lastMessageAt;
        await execute(
          'INSERT INTO sessions (id, agent_id, updated_at, meta) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, updated_at = excluded.updated_at, meta = excluded.meta',
          [payload.id, payload.agentId, payload.updatedAt, JSON.stringify(blob)]
        );
        return;
      }
      case 'message_appended': {
        if (!sessionId) return;
        const payload = change.data as Partial<MessageAppendedData>;
        if (!payload.message || typeof payload.seq !== 'number') {
          logger.warn(
            `${TAG} skip message_appended without payload seq=${change.seq}`
          );
          return;
        }
        await execute(
          'INSERT OR IGNORE INTO messages (seq, session_id, role, created_at, data) VALUES (?, ?, ?, ?, ?)',
          [
            payload.seq,
            sessionId,
            payload.message.role,
            payload.createdAt ?? change.createdAt,
            JSON.stringify(payload.message),
          ]
        );
        await execute(
          'UPDATE sessions SET updated_at = MAX(updated_at, ?) WHERE id = ?',
          [change.createdAt, sessionId]
        );
        return;
      }
      case 'turn_end': {
        if (!sessionId) return;
        const payload = change.data as { turnEnds?: number[] };
        const result = await execute('SELECT meta FROM sessions WHERE id = ?', [
          sessionId,
        ]);
        const row = result.rows[0] as { meta: string } | undefined;
        if (!row) return;
        const blob = JSON.parse(row.meta) as SessionBlob;
        blob.turnEnds = payload.turnEnds;
        await execute('UPDATE sessions SET meta = ? WHERE id = ?', [
          JSON.stringify(blob),
          sessionId,
        ]);
        return;
      }
      case 'session_deleted': {
        if (!sessionId) return;
        await execute('DELETE FROM messages WHERE session_id = ?', [sessionId]);
        await execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
        return;
      }
      case 'agents_invalidated': {
        // 表层无需改动，配置重拉由装配层在回放后触发
        return;
      }
      case 'launcher_prefs_updated': {
        // 偏好文档由 launcher-prefs 层处理，表层只推进游标
        return;
      }
      default:
        logger.warn(`${TAG} unknown change kind ${change.kind}`);
    }
  }

  /** 某角色的会话元信息列表，updatedAt 排序与服务端一致，chat 会话预览现算 */
  async listSessions(agentId: string): Promise<SessionMeta[]> {
    if (!this.hostId) {
      return [];
    }
    const result = await this.ensureDb().execute(
      'SELECT id, agent_id, updated_at, meta FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC',
      [agentId]
    );
    const rows = result.rows as unknown as Array<{
      id: string;
      agent_id: string;
      updated_at: number;
      meta: string;
    }>;
    const sessions: SessionMeta[] = [];
    for (const row of rows) {
      const blob = JSON.parse(row.meta) as SessionBlob;
      const meta: SessionMeta = { ...blob, updatedAt: row.updated_at };
      if (row.id.startsWith('chat')) {
        meta.lastMessage = await this.chatPreview(row.id);
      }
      sessions.push(meta);
    }
    return sessions;
  }

  /** 名下存在未读会话的 agent 清单，头像角标的聚合数据源 */
  async listUnreadAgentIds(): Promise<string[]> {
    if (!this.hostId) {
      return [];
    }
    const result = await this.ensureDb().execute(
      "SELECT DISTINCT agent_id FROM sessions WHERE json_extract(meta, '$.hasUnread') = 1"
    );
    const rows = result.rows as unknown as Array<{ agent_id: string }>;
    return rows.map((row) => row.agent_id);
  }

  /** 单会话元信息，前台会话的未读上报检查用，行不存在返回 null */
  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    if (!this.hostId) {
      return null;
    }
    const result = await this.ensureDb().execute(
      'SELECT updated_at, meta FROM sessions WHERE id = ?',
      [sessionId]
    );
    const row = (
      result.rows as unknown as Array<{ updated_at: number; meta: string }>
    )[0];
    if (!row) return null;
    const blob = JSON.parse(row.meta) as SessionBlob;
    return { ...blob, updatedAt: row.updated_at };
  }

  /** 从消息尾部提取聊天会话预览 */
  private async chatPreview(sessionId: string): Promise<string | undefined> {
    const result = await this.ensureDb().execute(
      `SELECT data FROM messages WHERE session_id = ? AND role IN ('user', 'assistant') ORDER BY seq DESC LIMIT 20`,
      [sessionId]
    );
    const rows = result.rows as unknown as Array<{ data: string }>;
    const tail = rows.map((r) => JSON.parse(r.data) as Message).reverse();
    return deriveSessionPreview(tail);
  }

  /** 会话更新时间单行查询，全量重读前的廉价预检查用 */
  async getSessionUpdatedAt(id: string): Promise<number | null> {
    if (!this.hostId) {
      return null;
    }
    const result = await this.ensureDb().execute(
      'SELECT updated_at FROM sessions WHERE id = ?',
      [id]
    );
    const row = result.rows[0] as unknown as { updated_at: number } | undefined;
    return row?.updated_at ?? null;
  }

  /** 完整会话，messages 混入轮次边界条目，与 HTTP 详情接口同形 */
  async getSession(id: string): Promise<MirrorSession | null> {
    if (!this.hostId) {
      return null;
    }
    const startedAt = Date.now();
    const metaResult = await this.ensureDb().execute(
      'SELECT id, agent_id, updated_at, meta FROM sessions WHERE id = ?',
      [id]
    );
    const row = metaResult.rows[0] as unknown as
      | { id: string; agent_id: string; updated_at: number; meta: string }
      | undefined;
    if (!row) {
      return null;
    }
    const blob = JSON.parse(row.meta) as SessionBlob;
    const messageResult = await this.ensureDb().execute(
      'SELECT seq, role, data FROM messages WHERE session_id = ? ORDER BY seq',
      [id]
    );
    const messageRows = messageResult.rows as unknown as Array<{
      seq: number;
      role: string;
      data: string;
    }>;
    const messages: Message[] = [];
    for (const messageRow of messageRows) {
      const message = JSON.parse(messageRow.data) as Message;
      message.seq = messageRow.seq;
      messages.push(message);
    }
    logger.info(
      `${TAG} session read, id=${id} messages=${messages.length} took=${
        Date.now() - startedAt
      }ms`
    );
    return {
      ...blob,
      updatedAt: row.updated_at,
      messages: mixTurnEnds(messages, blob.turnEnds),
    };
  }

  /** agent 表整体替换，快照装载与网络刷新共用 */
  private async replaceAgents(db: DB, agents: AgentInfo[]): Promise<void> {
    await db.executeBatch([
      ['DELETE FROM agents'],
      ...agents.map(
        (agent) =>
          [
            'INSERT INTO agents (id, data) VALUES (?, ?)',
            [agent.id, JSON.stringify(agent)],
          ] as [string, (string | number)[]]
      ),
    ]);
    logger.info(`${TAG} agents replaced: ${agents.length}`);
  }

  /** agent 列表整体替换，网络刷新经此落镜像 */
  putAgents(agents: AgentInfo[]): Promise<void> {
    return this.enqueueWrite(async () => {
      await this.replaceAgents(this.ensureDb(), agents);
      this.notify();
    });
  }

  /** 缓存的 agent 列表，冷启动与界面重读的数据源 */
  async listAgents(): Promise<AgentInfo[]> {
    if (!this.hostId) {
      return [];
    }
    const result = await this.ensureDb().execute('SELECT data FROM agents');
    return result.rows.map(
      (r) => JSON.parse((r as { data: string }).data) as AgentInfo
    );
  }
}

/** 全局镜像库单例，装配与读路径共用 */
export const cacheDb = new CacheDb();
