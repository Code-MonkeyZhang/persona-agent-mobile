/**
 * @file chat/util/launcherOrder.ts
 * @description 小手机桌面排列的纯函数模块。
 *   reconcileOrder、toGridItems 与 itemsToOrder 抄录自 persona-agent 仓
 *   @persona/shared 的 launcher.ts，遵循 sync-shapes 手工同步契约的既有先例，
 *   服务端契约变化时需手工同步。
 *   SETTINGS_SLOT_ID、GRID_COLS、padCells 与 orderFromPositions 为移动端独有，随本模块维护。
 */

/** 小手机内置设置伪 App 的保留槽位 id，slot 前缀不与真应用撞名 */
export const SETTINGS_SLOT_ID = 'slot:settings';

/** 桌面网格列数，与桌面端小手机一致 */
export const GRID_COLS = 4;

/** 空位占位 id 的保留前缀，不与应用 id 及 slot 前缀撞名 */
export const EMPTY_ID_PREFIX = 'empty:';

/** 网格条目，两端拖拽库都以带 id 的对象数组为数据源 */
export interface GridItem {
  id: string;
}

/**
 * 把已存排列与当前应用清单、槽位清单对账成展示序。
 *
 * - 应用组与 appIds 比对，清单里没有的条目清成 null，新应用填进第一个空位
 * - 槽位组只保证在场，缺的补进第一个空位，永不清理
 * - 末尾连续空位收掉，中间空位保留为拖放目标
 */
export function reconcileOrder(
  stored: (string | null)[] | null,
  appIds: string[],
  slots: string[]
): (string | null)[] {
  const valid = new Set([...appIds, ...slots]);
  const order = (stored ?? []).map((id) =>
    id !== null && valid.has(id) ? id : null
  );

  for (const id of [...appIds, ...slots]) {
    if (order.includes(id)) continue;
    const free = order.indexOf(null);
    if (free === -1) order.push(id);
    else order[free] = id;
  }

  while (order.length > 0 && order[order.length - 1] === null) order.pop();
  return order;
}

/**
 * 把补格后的槽位数组转成网格条目，空位按当前下标合成占位 id。
 * 槽位模型到拖拽库模型的唯一桥，两端共用。
 */
export function toGridItems(cells: (string | null)[]): GridItem[] {
  return cells.map((id, index) => ({
    id: id ?? `${EMPTY_ID_PREFIX}${index}`,
  }));
}

/**
 * 把网格条目还原成槽位数组，占位 id 还原为 null，末尾连续空位收掉。
 */
export function itemsToOrder(items: GridItem[]): (string | null)[] {
  const order = items.map(({ id }) =>
    id.startsWith(EMPTY_ID_PREFIX) ? null : id
  );
  while (order.length > 0 && order[order.length - 1] === null) order.pop();
  return order;
}

/**
 * 把补齐到整行网格的展示格数，空位补 null 供拖放命中。
 * 最少保持 minCells 格，与桌面端至少四行四列的约定一致。
 */
export function padCells(
  order: (string | null)[],
  minCells: number
): (string | null)[] {
  const cells = order.slice();
  let target = Math.max(minCells, cells.length);
  if (target % GRID_COLS !== 0) {
    target = Math.ceil(target / GRID_COLS) * GRID_COLS;
  }
  while (cells.length < target) cells.push(null);
  return cells;
}

/**
 * 把拖拽库的落位表还原成按格位排序的条目数组。
 * 网格的 swap 是累积式交换，一路悬停多个格子后的终局不是单次对调，
 * 必须按 positions 全量重建才能得到用户看到的最终布局。
 */
export function orderFromPositions(
  items: GridItem[],
  positions: Record<string, { index: number }>
): GridItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: GridItem[] = new Array(items.length);
  for (const [id, pos] of Object.entries(positions)) {
    const item = byId.get(id);
    if (item && pos.index >= 0 && pos.index < items.length) {
      ordered[pos.index] = item;
    }
  }
  return ordered;
}
