/**
 * @file storage/cache-db.ts
 * @description 移动端本地镜像库，服务端正本的只读镜像。
 *   op-sqlite 开库，schema 与桌面端同构四张表，读接口产出与 HTTP 接口同形的数据。
 *   写入口只收快照与变更流两类服务端事实，外加 agent 列表的离线副本。
 *   全部写操作串行走模块内的写队列，调用方无需关心与同步引擎的交错。
 */
import { open, type DB } from '@op-engineering/op-sqlite';
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

/** 缓存 kv 里的变更流游标键 */
const CURSOR_KEY = 'sync_cursor';

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
  /** 写操作串行队列，putAgents 与引擎的快照装载不会在事务上交错 */
  private writeQueue: Promise<unknown> = Promise.resolve();
  /** 写操作完成后的通知回调，界面层订阅后重读镜像 */
  private readonly listeners = new Set<() => void>();

  /** 惰性开库建表，WAL 模式让读写互不阻塞 */
  private ensureDb(): DB {
    if (this.db) {
      return this.db;
    }
    const db = open({ name: 'persona-cache' });
    db.execute('PRAGMA journal_mode = WAL');
    for (const sql of DDL) {
      db.execute(sql);
    }
    logger.info(`${TAG} opened persona-cache, ${DDL.length} ddl statements`);
    this.db = db;
    return db;
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
  getCursor(): number {
    const row = this.ensureDb().executeSync(
      'SELECT value FROM kv WHERE key = ?',
      [CURSOR_KEY]
    ).rows[0] as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  private setCursor(value: number): void {
    this.ensureDb().executeSync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [CURSOR_KEY, String(value)]
    );
  }

  /** 全量快照整体入库，先清空再分块装载，游标推进到快照序号 */
  applySnapshot(snapshot: SyncSnapshot): Promise<void> {
    return this.enqueueWrite(async () => {
      const db = this.ensureDb();
      db.execute('DELETE FROM messages');
      db.execute('DELETE FROM sessions');
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
      this.setCursor(snapshot.latestSeq);
      logger.info(
        `${TAG} snapshot applied: ${snapshot.sessions.length} sessions ${messageCount} messages latestSeq=${snapshot.latestSeq}`
      );
      this.notify();
    });
  }

  /** 按序回放变更流，游标之前的事件跳过，消息按行号幂等 */
  applyChanges(changes: SessionChange[]): Promise<void> {
    return this.enqueueWrite(async () => {
      const db = this.ensureDb();
      let cursor = this.getCursor();
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
          this.setCursor(cursor);
        }
      });
      if (applied > 0) {
        logger.info(`${TAG} applied ${applied} changes, cursor=${cursor}`);
        this.notify();
      }
    });
  }

  /** 回放单个变更事件，载荷缺失时记日志跳过 */
  private async applyChange(
    execute: (
      query: string,
      params?: Array<string | number | null>
    ) => Promise<unknown>,
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
        const row = this.ensureDb().executeSync(
          'SELECT meta FROM sessions WHERE id = ?',
          [sessionId]
        ).rows[0] as { meta: string } | undefined;
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
      default:
        logger.warn(`${TAG} unknown change kind ${change.kind}`);
    }
  }

  /** 某角色的会话元信息列表，updatedAt 排序与服务端一致，chat 会话预览现算 */
  listSessions(agentId: string): SessionMeta[] {
    const rows = this.ensureDb().executeSync(
      'SELECT id, agent_id, updated_at, meta FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC',
      [agentId]
    ).rows as unknown as Array<{
      id: string;
      agent_id: string;
      updated_at: number;
      meta: string;
    }>;
    return rows.map((row) => {
      const blob = JSON.parse(row.meta) as SessionBlob;
      const meta: SessionMeta = { ...blob, updatedAt: row.updated_at };
      if (row.id.startsWith('chat')) {
        meta.lastMessage = this.chatPreview(row.id);
      }
      return meta;
    });
  }

  /** 从消息尾部提取聊天会话预览 */
  private chatPreview(sessionId: string): string | undefined {
    const rows = this.ensureDb().executeSync(
      `SELECT data FROM messages WHERE session_id = ? AND role IN ('user', 'assistant') ORDER BY seq DESC LIMIT 20`,
      [sessionId]
    ).rows as unknown as Array<{ data: string }>;
    const tail = rows.map((r) => JSON.parse(r.data) as Message).reverse();
    return deriveSessionPreview(tail);
  }

  /** 会话更新时间单行查询，全量重读前的廉价预检查用 */
  getSessionUpdatedAt(id: string): number | null {
    const row = this.ensureDb().executeSync(
      'SELECT updated_at FROM sessions WHERE id = ?',
      [id]
    ).rows[0] as unknown as { updated_at: number } | undefined;
    return row?.updated_at ?? null;
  }

  /** 完整会话，messages 混入轮次边界条目，与 HTTP 详情接口同形 */
  getSession(id: string): MirrorSession | null {
    const row = this.ensureDb().executeSync(
      'SELECT id, agent_id, updated_at, meta FROM sessions WHERE id = ?',
      [id]
    ).rows[0] as unknown as
      | { id: string; agent_id: string; updated_at: number; meta: string }
      | undefined;
    if (!row) {
      return null;
    }
    const blob = JSON.parse(row.meta) as SessionBlob;
    const messageRows = this.ensureDb().executeSync(
      'SELECT seq, role, data FROM messages WHERE session_id = ? ORDER BY seq',
      [id]
    ).rows as unknown as Array<{
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
    return {
      ...blob,
      updatedAt: row.updated_at,
      messages: mixTurnEnds(messages, blob.turnEnds),
    };
  }

  /** agent 列表整体替换，离线回退的数据源 */
  putAgents(agents: AgentInfo[]): Promise<void> {
    return this.enqueueWrite(async () => {
      const db = this.ensureDb();
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
      this.notify();
    });
  }

  /** 缓存的 agent 列表，离线回退用 */
  listAgents(): AgentInfo[] {
    const rows = this.ensureDb().executeSync('SELECT data FROM agents').rows;
    return rows.map(
      (r) => JSON.parse((r as { data: string }).data) as AgentInfo
    );
  }
}

/** 全局镜像库单例，装配与读路径共用 */
export const cacheDb = new CacheDb();
