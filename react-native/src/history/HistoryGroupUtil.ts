/**
 * @file HistoryGroupUtil.ts
 * @description 聊天历史按日期分组的工具函数。
 * 将平铺的会话列表按「Today / Yesterday / N days ago / Last week / N weeks ago / YYYY.MM」分组，
 * 在每组前插入一个 id 为负数的虚拟标题行，供 FlatList 渲染分隔标题。
 */
import { Chat } from '../types/Chat.ts';

/**
 * 将会话列表按时间分组，在每组第一条消息前插入虚拟标题行。
 *
 * 分组规则（按 updatedAt 比较）：
 * - Today / Yesterday / 2-6 days ago（最近7天逐天分组）
 * - Last week / 2-4 weeks ago（按周分组）
 * - 超过4周：按「YYYY.MM」月份分组
 *
 * 虚拟标题行的 id 为负数（如 -1, -2），title 为分组名，不会与真实会话冲突。
 * FlatList 渲染时根据 id 是否以 '-' 开头来区分标题行和会话行。
 */
export function groupMessagesByDate(messages: Chat[]) {
  const groupChat: Chat[] = [];
  /** 已出现的分组标题集合，防止重复插入 */
  const groupTitleSet = new Set<string>();

  const todayTimestamp = getTodayTimestamp();
  /** 一天的毫秒数，用于计算各时间区间的边界 */
  const oneDayMs = 24 * 60 * 60 * 1000;
  const yesterday = todayTimestamp - oneDayMs;
  const ago2days = todayTimestamp - 2 * oneDayMs;
  const ago3days = todayTimestamp - 3 * oneDayMs;
  const ago4days = todayTimestamp - 4 * oneDayMs;
  const ago5days = todayTimestamp - 5 * oneDayMs;
  const ago6days = todayTimestamp - 6 * oneDayMs;
  /** 7-13天归为 "Last week" */
  const lastWeek = todayTimestamp - 13 * oneDayMs;
  const ago2week = todayTimestamp - 20 * oneDayMs;
  const ago3week = todayTimestamp - 27 * oneDayMs;
  const ago4week = todayTimestamp - 34 * oneDayMs;
  /** 月份分组的缓存，避免同一月重复计算 */
  let currentMonthTimestamp = 0;
  let currentMonthTitle = '';
  messages.forEach((message) => {
    let groupTitle = '';
    if (message.updatedAt >= todayTimestamp) {
      groupTitle = 'Today';
    } else if (message.updatedAt >= yesterday) {
      groupTitle = 'Yesterday';
    } else if (message.updatedAt >= ago2days) {
      groupTitle = '2 days ago';
    } else if (message.updatedAt >= ago3days) {
      groupTitle = '3 days ago';
    } else if (message.updatedAt >= ago4days) {
      groupTitle = '4 days ago';
    } else if (message.updatedAt >= ago5days) {
      groupTitle = '5 days ago';
    } else if (message.updatedAt >= ago6days) {
      groupTitle = '6 days ago';
    } else if (message.updatedAt >= lastWeek) {
      groupTitle = 'Last week';
    } else if (message.updatedAt >= ago2week) {
      groupTitle = '2 weeks ago';
    } else if (message.updatedAt >= ago3week) {
      groupTitle = '3 weeks ago';
    } else if (message.updatedAt >= ago4week) {
      groupTitle = '4 weeks ago';
    } else {
      /** 超过4周的会话按月份分组（格式 "2025.01"） */
      if (
        currentMonthTimestamp !== 0 &&
        message.updatedAt >= currentMonthTimestamp
      ) {
        groupTitle = currentMonthTitle;
      } else {
        groupTitle = formatTimestampToYearMonth(message.updatedAt);
        currentMonthTitle = groupTitle;
        currentMonthTimestamp = getFirstDayOfMonthTimestamp(groupTitle);
      }
    }
    /** 如果该分组标题首次出现，在列表中插入一条虚拟标题行（id 为负数） */
    if (!groupTitleSet.has(groupTitle)) {
      groupChat.push({
        id: String(-(groupTitleSet.size + 1)),
        title: groupTitle,
        updatedAt: 0,
        createdAt: 0,
      });
      groupTitleSet.add(groupTitle);
    }
    groupChat.push(message);
  });
  return groupChat;
}

/** 获取今天零点的时间戳，作为所有日期比较的基准 */
function getTodayTimestamp() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate());
  return now.getTime();
}

/** 将时间戳格式化为 "YYYY.MM" 形式的月份标题 */
function formatTimestampToYearMonth(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${year}.${month}`;
}

/** 根据 "YYYY.MM" 格式的月份标题，计算该月第一天零点的时间戳 */
function getFirstDayOfMonthTimestamp(yearMonth: string) {
  const [year, month] = yearMonth.split('.').map(Number);
  const date = new Date(year, month - 1, 1, 0, 0, 0, 0);
  return date.getTime();
}
