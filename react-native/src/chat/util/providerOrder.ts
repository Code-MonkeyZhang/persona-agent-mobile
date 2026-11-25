/**
 * @file providerOrder.ts
 * @description 供应商排序纯函数，聊天页与 Agent 详情页的模型弹层共用。
 *   与桌面端 lib/providerOrder.ts 的 orderForSelector 同文本，两个仓没有共享包，改规则要两边一起改。
 */

/** 参与排序的供应商需携带的最小字段 */
export interface OrderableProvider {
  id: string;
  name: string;
}

/**
 * 模型选择器的供应商排位，heads 按优先级从高到低给出要置顶的供应商，同一家只出现一次
 * @param providers 已配置密钥的供应商，按接口下发的配置顺序传入
 * @param heads 依次是当前在用的、Agent 默认的、上次使用的供应商 id，缺省的位次跳过
 * @returns 置顶供应商在前、其余保持传入顺序的新数组
 */
export function orderForSelector<T extends OrderableProvider>(
  providers: T[],
  ...heads: (string | undefined)[]
): T[] {
  const front: T[] = [];
  for (const id of heads) {
    const hit = providers.find((p) => p.id === id);
    if (hit && !front.includes(hit)) front.push(hit);
  }
  return [...front, ...providers.filter((p) => !front.includes(p))];
}
