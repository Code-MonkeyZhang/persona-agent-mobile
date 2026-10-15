/**
 * @file launcherOrder.test.ts
 * @description 桌面排列纯函数的直测，覆盖对账、空位填充、槽位补位、
 *   末尾收空、补格、条目桥接与落位重建边界，不依赖 RN 环境。
 */
import {
  reconcileOrder,
  toGridItems,
  itemsToOrder,
  orderFromPositions,
  padCells,
  EMPTY_ID_PREFIX,
  SETTINGS_SLOT_ID,
  GRID_COLS,
} from '../src/chat/util/launcherOrder';

describe('reconcileOrder', () => {
  it('无存量时按清单顺序排布', () => {
    expect(reconcileOrder(null, ['a', 'b'], [SETTINGS_SLOT_ID])).toEqual([
      'a',
      'b',
      SETTINGS_SLOT_ID,
    ]);
  });

  it('新应用填进第一个空位', () => {
    expect(reconcileOrder(['a', null, 'b'], ['a', 'b', 'c'], [])).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('清单里消失的应用清成 null，中间空位保留尾部收空', () => {
    expect(reconcileOrder(['a', 'b'], ['b'], [])).toEqual([null, 'b']);
    expect(reconcileOrder(['a', null, 'b'], ['a'], [])).toEqual(['a']);
  });

  it('槽位永不清理，缺的补进第一个空位', () => {
    expect(reconcileOrder(['a', 'b'], ['a', 'b'], [SETTINGS_SLOT_ID])).toEqual([
      'a',
      'b',
      SETTINGS_SLOT_ID,
    ]);
    expect(
      reconcileOrder([SETTINGS_SLOT_ID, 'a'], ['a'], [SETTINGS_SLOT_ID])
    ).toEqual([SETTINGS_SLOT_ID, 'a']);
  });

  it('非法 id 清成 null 保留占位', () => {
    expect(reconcileOrder(['ghost', 'a'], ['a'], [])).toEqual([null, 'a']);
  });
});

describe('padCells', () => {
  it('不足最少格数补到最少，空位补 null', () => {
    const cells = padCells(['a', 'b', 'c'], GRID_COLS * 4);
    expect(cells).toHaveLength(GRID_COLS * 4);
    expect(cells.slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect(cells.slice(3).every((c) => c === null)).toBe(true);
  });

  it('超过最少格数补齐到整行', () => {
    const many = Array.from({ length: GRID_COLS * 4 + 1 }, (_, i) => `a${i}`);
    expect(padCells(many, GRID_COLS * 4)).toHaveLength(GRID_COLS * 5);
  });
});

describe('grid item bridge', () => {
  it('空位按下标合成占位 id，占用位保留原 id', () => {
    expect(toGridItems(['a', null, SETTINGS_SLOT_ID])).toEqual([
      { id: 'a' },
      { id: `${EMPTY_ID_PREFIX}1` },
      { id: SETTINGS_SLOT_ID },
    ]);
  });

  it('占位 id 还原为 null，末尾连续空位收掉', () => {
    expect(
      itemsToOrder([
        { id: `${EMPTY_ID_PREFIX}1` },
        { id: 'a' },
        { id: `${EMPTY_ID_PREFIX}2` },
        { id: `${EMPTY_ID_PREFIX}3` },
      ])
    ).toEqual([null, 'a']);
  });

  it('槽位数组经条目模型往返后还原', () => {
    const order = ['a', null, 'b', SETTINGS_SLOT_ID];
    expect(itemsToOrder(toGridItems(order))).toEqual(order);
  });
});

describe('orderFromPositions', () => {
  it('按落位表全量重建条目数组', () => {
    const items = toGridItems(['a', 'b', null, 'c']);
    const positions = {
      a: { index: 2 },
      b: { index: 0 },
      [`${EMPTY_ID_PREFIX}2`]: { index: 3 },
      c: { index: 1 },
    };
    expect(orderFromPositions(items, positions).map((i) => i.id)).toEqual([
      'b',
      'c',
      'a',
      `${EMPTY_ID_PREFIX}2`,
    ]);
  });

  it('落位表越界或缺席的条目不挤占其他格位', () => {
    const items = toGridItems(['a', 'b']);
    expect(
      orderFromPositions(items, { a: { index: 5 }, b: { index: 0 } })
    ).toEqual([{ id: 'b' }, undefined]);
  });
});
