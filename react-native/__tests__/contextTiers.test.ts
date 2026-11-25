/**
 * @file contextTiers.test.ts
 * @description 容量归档纯函数的直测，用例照桌面端 tests/contextTiers.test.ts。
 */
import { tierOf } from '../src/chat/util/contextTiers';

describe('tierOf 精确容量就近归档', () => {
  it('档位表上的精确值返回对应档位', () => {
    expect(tierOf(8192)).toBe('8K');
    expect(tierOf(204800)).toBe('200K');
    expect(tierOf(1048576)).toBe('1M');
  });

  it('档位之间的值就近归档', () => {
    expect(tierOf(128000)).toBe('128K');
    expect(tierOf(100000)).toBe('128K');
    expect(tierOf(1047576)).toBe('1M');
  });

  it('档位表两端的值收敛到端点档位', () => {
    expect(tierOf(1)).toBe('4K');
    expect(tierOf(99999999)).toBe('2M');
  });
});
