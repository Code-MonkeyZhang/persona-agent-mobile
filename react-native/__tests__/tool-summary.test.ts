/**
 * @file __tests__/tool-summary.test.ts
 * @description 摘要与动向句纯函数的单测，锁共享包镜像的口径，
 *   全名进短名出是断言核心，权威版本再改而镜像没跟上时这里先红。
 *   覆盖剥前缀、摘要查表归一化、动向句三级取值链与掩码四组路径。
 */
import {
  shortToolName,
  summarizeToolInput,
  stepPhrase,
  type NarrationTranslate,
} from '../src/lib/tool-summary';

/** 测试用文案表，插值按 i18n 的 {{name}} 形态替换 */
const dict: Record<string, string> = {
  'live.thinking': '思考中',
  'live.read': '正在读取',
  'live.bash': '运行',
  'live.executing': '正在执行',
};

const t: NarrationTranslate = (key, opts) =>
  Object.entries(opts ?? {}).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)),
    dict[key] ?? key
  );

describe('shortToolName', () => {
  it('剥掉内置条目的全名前缀', () => {
    expect(shortToolName('built_in_memory__update')).toBe('update');
  });

  it('剥掉 MCP 服务的全名前缀', () => {
    expect(shortToolName('dida365__list_undone_tasks_by_time_query')).toBe(
      'list_undone_tasks_by_time_query'
    );
  });

  it('无前缀的短名原样返回', () => {
    expect(shortToolName('bash')).toBe('bash');
  });
});

describe('summarizeToolInput', () => {
  it('内置全名查表前归一化，取命令做摘要', () => {
    expect(
      summarizeToolInput('built_in_terminal__bash', { command: 'ls -la' })
    ).toBe('ls -la');
  });

  it('文件工具全名归一化后取路径做摘要', () => {
    expect(
      summarizeToolInput('built_in_files__read_file', { path: '/tmp/a.ts' })
    ).toBe('/tmp/a.ts');
  });

  it('未登记工具压成 JSON 串并打码凭据', () => {
    const summary = summarizeToolInput('built_in_memory__update', {
      content: 'hello',
      api_key: 'sk-abcdefghijklmnop',
    });
    expect(summary).toContain('hello');
    expect(summary).toContain('********');
    expect(summary).not.toContain('sk-abcdefghijklmnop');
  });
});

describe('stepPhrase', () => {
  it('模型自写短标题第一优先', () => {
    expect(
      stepPhrase(t, {
        tool: 'built_in_memory__update',
        detail: '',
        toolTitle: '查滴答清单今日待办',
      })
    ).toBe('查滴答清单今日待办');
  });

  it('内置全名查表前归一化，bash 走设计短句', () => {
    expect(
      stepPhrase(t, {
        tool: 'built_in_terminal__bash',
        detail: 'npm run test',
      })
    ).toBe('运行 npm run test');
  });

  it('未登记工具兜底显示短名', () => {
    expect(
      stepPhrase(t, { tool: 'built_in_memory__update', detail: '' })
    ).toBe('正在执行 update');
  });

  it('MCP 全名兜底同样只显短名', () => {
    expect(
      stepPhrase(t, { tool: 'deepwiki__search', detail: '' })
    ).toBe('正在执行 search');
  });
});
