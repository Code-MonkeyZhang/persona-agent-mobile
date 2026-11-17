/**
 * @file usage-math.ts
 * @description 上下文占用的显示数学，占用小壳消费。
 *   同数落定判定语义照桌面端 ContextUsageShell 同款移植，纯函数不依赖 RN 环境。
 */

/**
 * 判断两个占用数字取整后是否同一百分比，供补间跳过判定。
 *
 * 同数直接落定不播动画，低于一个百分点的微涨微落在画面上无感，
 * 也消除静止整数与补间小数两种口径切换造成的起止位置跳变。
 * @param from 变动前的分子
 * @param to 变动后的分子
 * @param windowSize 上下文窗口，非正数视为同数直接落定
 */
export function sameRoundedPercent(
  from: number,
  to: number,
  windowSize: number
): boolean {
  if (windowSize <= 0) return true;
  return (
    Math.round((from / windowSize) * 100) ===
    Math.round((to / windowSize) * 100)
  );
}
