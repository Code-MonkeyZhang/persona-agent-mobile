/**
 * @file notify.ts
 * @description 应用内通知的唯一入口，包装 react-native-toast-message 的 show。
 *   - 词表固定 warn error info，warn 条件不具备，error 已经失败，info 正在进行
 *   - 文案在入口统一翻译，调用方只传 i18n key 与插值
 *   - 位置契约分基线与抬升量，基线是安全区底由挂载点注册，聊天页注册输入浮层顶边作抬升量
 *   - bottomOffset 在 show 时刻取值，显示期间不随键盘变动，2.6 秒瞬态可接受
 */
import Toast from 'react-native-toast-message';
import i18n from '../i18n/index.ts';
import { logger } from './logger';

/** 通知类型词表，NoticeToast 按类型取前置图标 */
export type NoticeType = 'warn' | 'error' | 'info';

/** 安全区底的基线偏移，Toast 挂载点注册 */
let baseInset = 0;

/** 当前页的浮层抬升量，聊天页注册输入浮层顶边 */
let pageLift = 0;

/** 弹出一条胶囊，type 决定前置图标，bottomOffset 取基线加抬升量的当前值 */
function show(
  type: NoticeType,
  key: string,
  values?: Record<string, string>
): void {
  logger.debug(`[Notify] ${type} ${key}`);
  Toast.show({
    type,
    text1: i18n.t(key, values),
    bottomOffset: baseInset + pageLift,
  });
}

/** 注册安全区底作基线偏移，挂载点在导航容器内取 insets 后调用 */
function setBaseInset(px: number): void {
  baseInset = px;
}

/** 注册当前页的浮层抬升量，页面失焦或卸载时清零回基线 */
function setPageLift(px: number): void {
  pageLift = px;
}

/** 应用内通知的唯一入口，静态行为默认值由 App 的挂载宿主声明 */
export const notify = {
  warn: (key: string, values?: Record<string, string>) =>
    show('warn', key, values),
  error: (key: string, values?: Record<string, string>) =>
    show('error', key, values),
  info: (key: string, values?: Record<string, string>) =>
    show('info', key, values),
  setBaseInset,
  setPageLift,
};
