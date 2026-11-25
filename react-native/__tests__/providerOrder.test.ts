/**
 * @file providerOrder.test.ts
 * @description 供应商排位纯函数的直测，用例照桌面端 tests/providerOrder.test.ts。
 */
import {
  orderForSelector,
  type OrderableProvider,
} from '../src/chat/util/providerOrder';

/** 按给定 id 造一组供应商，名称与 id 相同 */
const providersOf = (...ids: string[]): OrderableProvider[] =>
  ids.map((id) => ({ id, name: id }));

/** 取排位结果里的 id 序列 */
const idsOf = (providers: OrderableProvider[]) => providers.map((p) => p.id);

describe('orderForSelector 模型弹层的供应商排位', () => {
  it('没有位次输入时保持传入的配置顺序', () => {
    expect(
      idsOf(orderForSelector(providersOf('zai', 'deepseek', 'openai')))
    ).toEqual(['zai', 'deepseek', 'openai']);
  });

  it('当前在用、Agent 默认、上次使用依次置顶，其余保持配置顺序', () => {
    const result = orderForSelector(
      providersOf('zai', 'deepseek', 'openai', 'kimi-coding'),
      'openai',
      'kimi-coding',
      'zai'
    );
    expect(idsOf(result)).toEqual(['openai', 'kimi-coding', 'zai', 'deepseek']);
  });

  it('同一家落在几个位次时只出现一次', () => {
    const result = orderForSelector(
      providersOf('zai', 'deepseek'),
      'deepseek',
      'deepseek',
      undefined
    );
    expect(idsOf(result)).toEqual(['deepseek', 'zai']);
  });

  it('位次上的供应商不在已配置清单里时跳过', () => {
    const result = orderForSelector(
      providersOf('zai', 'deepseek'),
      'anthropic',
      undefined,
      'kimi-coding'
    );
    expect(idsOf(result)).toEqual(['zai', 'deepseek']);
  });

  it('排位不改动入参', () => {
    const input = providersOf('zai', 'deepseek');
    orderForSelector(input, 'deepseek');
    expect(idsOf(input)).toEqual(['zai', 'deepseek']);
  });
});
