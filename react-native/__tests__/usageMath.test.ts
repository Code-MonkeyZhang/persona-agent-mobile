/**
 * @file usageMath.test.ts
 * @description 占用显示数学的直测，同数落定判定照桌面端同款边界用例。
 */
import { sameRoundedPercent } from '../src/chat/util/usage-math';

describe('sameRoundedPercent 补间跳过判定', () => {
  it('回合末微差取整同数判真，直接落定不播动画', () => {
    // 百万窗口下 10.94% 与 10.95% 的回合落盘微差
    expect(sameRoundedPercent(109387, 109489, 1000000)).toBe(true);
  });

  it('取整边界两侧的四舍五入同归一处判真', () => {
    // 9.6% 与 10.3% 都取整到 10
    expect(sameRoundedPercent(96000, 103000, 1000000)).toBe(true);
  });

  it('跨过整数边界判假走补间', () => {
    // 9.4% 与 10.6% 取整到 9 与 11
    expect(sameRoundedPercent(94000, 106000, 1000000)).toBe(false);
  });

  it('窗口非法判真兜底直落', () => {
    expect(sameRoundedPercent(100, 200, 0)).toBe(true);
  });
});
