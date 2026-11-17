/**
 * @file __tests__/toolsStore.test.ts
 * @description 工具注册表 store 的单测，网络与存储依赖全部替身，覆盖
 *   拉取成功落清单、拉取失败落错误、过期响应丢弃、分配乐观翻转、
 *   在途乐观值补丁、失败回真相与按条目单飞七条主路径，
 *   外加切换语义三条，关到开、开到关与条目缺失静默返回。
 */
import { Alert } from 'react-native';
import { useToolsStore } from '../src/stores/toolsStore';
import {
  listTools,
  assignTool,
  type ToolEntryInfo,
} from '../src/api/server-api';

jest.mock('../src/api/server-api', () => ({
  listTools: jest.fn(),
  assignTool: jest.fn(),
}));

jest.mock('../src/storage/StorageUtils', () => ({
  getServerAddress: jest.fn(() => 'http://server'),
  getServerAgentId: jest.fn(() => 'agent-1'),
}));

jest.mock('../src/i18n/index', () => ({
  __esModule: true,
  default: { language: 'zh', t: (key: string) => key },
}));

jest.mock('../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedListTools = listTools as jest.MockedFunction<typeof listTools>;
const mockedAssignTool = assignTool as jest.MockedFunction<typeof assignTool>;
const mockedAlert = jest.spyOn(Alert, 'alert');

/** 造一个已连接的内置条目，assigned 由用例指定 */
function entry(id: string, assigned: boolean) {
  return {
    id,
    kind: 'builtin' as const,
    name: id,
    status: 'connected' as const,
    functions: [],
    assigned,
  };
}

/** 等一拍让 store 内部的异步走完 */
const flush = () =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

/** 造一个手动放行的 Promise，用例用它控制网络响应落地顺序 */
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('useToolsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListTools.mockResolvedValue([]);
    useToolsStore.setState({
      entries: null,
      entriesError: null,
      lastAgentId: undefined,
      assigning: new Map(),
    });
  });

  it('loads entries with the bound agent id and request language', async () => {
    mockedListTools.mockResolvedValue([entry('built_in_terminal', true)]);
    await useToolsStore.getState().loadTools();
    expect(mockedListTools).toHaveBeenCalledWith(
      'http://server',
      'agent-1',
      'zh'
    );
    expect(useToolsStore.getState().entries?.map((e) => e.id)).toEqual([
      'built_in_terminal',
    ]);
    expect(useToolsStore.getState().entriesError).toBeNull();
    expect(useToolsStore.getState().lastAgentId).toBe('agent-1');
  });

  it('records load failure without clearing loaded entries', async () => {
    useToolsStore.setState({ entries: [entry('a', true)] });
    mockedListTools.mockRejectedValue(new Error('boom'));
    await useToolsStore.getState().loadTools();
    expect(useToolsStore.getState().entriesError).toBe('boom');
    expect(useToolsStore.getState().entries).toHaveLength(1);
  });

  it('drops a stale load response so late old data never lands', async () => {
    const first = deferred<ToolEntryInfo[]>();
    const second = deferred<ToolEntryInfo[]>();
    mockedListTools
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const stale = useToolsStore.getState().loadTools();
    const fresh = useToolsStore.getState().loadTools();
    second.release([entry('fresh', true)]);
    await fresh;
    first.release([entry('stale', false)]);
    await stale;
    expect(useToolsStore.getState().entries?.map((e) => e.id)).toEqual([
      'fresh',
    ]);
  });

  it('flips the entry optimistically before the write lands', async () => {
    useToolsStore.setState({ entries: [entry('built_in_web', false)] });
    const write = deferred<void>();
    mockedAssignTool.mockImplementationOnce(() => write.promise);
    const pending = useToolsStore
      .getState()
      .setAssignment('agent-1', 'built_in_web', true);
    expect(useToolsStore.getState().entries?.[0]?.assigned).toBe(true);
    expect(useToolsStore.getState().assigning.has('built_in_web')).toBe(true);
    write.release(undefined);
    await pending;
    expect(mockedListTools).toHaveBeenCalledTimes(1);
    expect(useToolsStore.getState().assigning.has('built_in_web')).toBe(false);
  });

  it('patches a landing list with the in-flight optimistic value', async () => {
    useToolsStore.setState({ entries: [entry('built_in_web', false)] });
    const write = deferred<void>();
    mockedAssignTool.mockImplementationOnce(() => write.promise);
    mockedListTools
      .mockResolvedValueOnce([entry('built_in_web', false)])
      .mockResolvedValue([entry('built_in_web', true)]);
    const pending = useToolsStore
      .getState()
      .setAssignment('agent-1', 'built_in_web', true);
    await useToolsStore.getState().loadTools();
    expect(useToolsStore.getState().entries?.[0]?.assigned).toBe(true);
    write.release(undefined);
    await pending;
    expect(useToolsStore.getState().entries?.[0]?.assigned).toBe(true);
  });

  it('restores server truth after a failed write', async () => {
    useToolsStore.setState({ entries: [entry('built_in_web', true)] });
    mockedAssignTool.mockRejectedValue(new Error('denied'));
    mockedListTools.mockResolvedValue([entry('built_in_web', true)]);
    await useToolsStore
      .getState()
      .setAssignment('agent-1', 'built_in_web', false);
    expect(mockedAlert).toHaveBeenCalled();
    expect(useToolsStore.getState().entries?.[0]?.assigned).toBe(true);
    expect(useToolsStore.getState().assigning.has('built_in_web')).toBe(false);
  });

  it('skips a second write on the same entry while one is in flight', async () => {
    const write = deferred<void>();
    mockedAssignTool.mockImplementation(() => write.promise);
    const first = useToolsStore.getState().setAssignment('agent-1', 'x', true);
    await useToolsStore.getState().setAssignment('agent-1', 'x', false);
    expect(mockedAssignTool).toHaveBeenCalledTimes(1);
    write.release(undefined);
    await first;
  });

  it('runs writes on different entries in parallel', async () => {
    const a = deferred<void>();
    const b = deferred<void>();
    mockedAssignTool
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => b.promise);
    const first = useToolsStore.getState().setAssignment('agent-1', 'x', true);
    const second = useToolsStore.getState().setAssignment('agent-1', 'y', true);
    expect(mockedAssignTool).toHaveBeenCalledTimes(2);
    a.release(undefined);
    b.release(undefined);
    await Promise.all([first, second]);
  });

  it('toggles an unassigned entry on by inverting the current state', async () => {
    useToolsStore.setState({ entries: [entry('built_in_web', false)] });
    await useToolsStore.getState().toggleAssignment('built_in_web');
    expect(mockedAssignTool).toHaveBeenCalledWith(
      'http://server',
      'agent-1',
      'built_in_web',
      true
    );
  });

  it('toggles an assigned entry off by inverting the current state', async () => {
    useToolsStore.setState({
      entries: [entry('built_in_web', true)],
      lastAgentId: 'agent-1',
    });
    await useToolsStore.getState().toggleAssignment('built_in_web');
    expect(mockedAssignTool).toHaveBeenCalledWith(
      'http://server',
      'agent-1',
      'built_in_web',
      false
    );
  });

  it('returns silently when toggling an entry missing from the registry', async () => {
    useToolsStore.setState({ entries: [entry('a', true)] });
    await useToolsStore.getState().toggleAssignment('missing');
    expect(mockedAssignTool).not.toHaveBeenCalled();
  });

  it('reloads once per invalidated seq and skips repeated seqs', async () => {
    mockedListTools.mockResolvedValue([]);
    useToolsStore.setState({ lastAgentId: 'agent-1' });
    useToolsStore.getState().consumeInvalidation(5);
    await flush();
    useToolsStore.getState().consumeInvalidation(5);
    await flush();
    expect(mockedListTools).toHaveBeenCalledTimes(1);
    useToolsStore.getState().consumeInvalidation(6);
    await flush();
    expect(mockedListTools).toHaveBeenCalledTimes(2);
  });
});
