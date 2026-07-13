/**
 * @file thought-utils.ts
 * @description 思考过程的结构化工具函数：流式事件转 Thought、去重、图标/颜色/标签映射、工具格式化。
 *              参考桌面端 chatStore.ts / thought-utils.ts，逻辑完全对齐。
 */
import {
  Lightbulb,
  Braces,
  XCircle,
  Zap,
  MessageSquare,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import uuid from 'uuid';
import i18n from '../../i18n/index.ts';
import type { Thought, ThoughtType } from '../../types/Thought';
import type { ToolCall, WsToolResult } from '../../api/server-api';

/**
 * 将一个 step_complete 事件转换为 Thought 数组。
 * 顺序为 thinking → text → tool_use，每个 step 的批次追加到已有 steps 末尾。
 */
export function cycleToThoughts(
  content: string | undefined,
  thinking: string | undefined,
  toolCalls?: ToolCall[],
  toolResults?: WsToolResult[]
): Thought[] {
  const thoughts: Thought[] = [];

  if (thinking) {
    thoughts.push({ id: uuid.v4(), type: 'thinking', content: thinking });
  }

  if (content) {
    thoughts.push({ id: uuid.v4(), type: 'text', content });
  }

  toolCalls?.forEach((tc) => {
    const result = toolResults?.find((r) => r.toolCallId === tc.id);
    thoughts.push({
      id: tc.id,
      type: 'tool_use',
      toolName: tc.name,
      toolInput: tc.arguments,
      toolResult: result
        ? { output: result.result, isError: !result.success }
        : undefined,
    });
  });

  return thoughts;
}

/**
 * 移除 steps 中最后一条 text thought。
 * 最终回复已在消息气泡展示，时间线中不再重复。
 */
export function stripLastTextThought(thoughts: Thought[]): Thought[] {
  for (let i = thoughts.length - 1; i >= 0; i--) {
    if (thoughts[i].type === 'text') {
      return thoughts.filter((_, idx) => idx !== i);
    }
  }
  return thoughts;
}

/** 获取 Thought 类型对应的图标组件 */
export function getThoughtIcon(
  type: ThoughtType
): ComponentType<{ size?: number; color?: string }> {
  switch (type) {
    case 'thinking':
      return Lightbulb as ComponentType<{ size?: number; color?: string }>;
    case 'text':
      return MessageSquare as ComponentType<{ size?: number; color?: string }>;
    case 'tool_use':
      return Braces as ComponentType<{ size?: number; color?: string }>;
    case 'error':
      return XCircle as ComponentType<{ size?: number; color?: string }>;
    default:
      return Zap as ComponentType<{ size?: number; color?: string }>;
  }
}

/** 获取 Thought 类型对应的颜色（hex 值，用于图标和文本） */
export function getThoughtColor(type: ThoughtType, isError?: boolean): string {
  if (isError) {
    return '#f59e0b';
  }
  switch (type) {
    case 'thinking':
    case 'text':
    case 'tool_use':
      return '#60a5fa';
    case 'error':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

/** 获取 Thought 类型对应的本地化标签 */
export function getThoughtLabel(type: ThoughtType): string {
  switch (type) {
    case 'thinking':
      return i18n.t('thought.thinking');
    case 'text':
      return i18n.t('thought.text');
    case 'tool_use':
      return i18n.t('thought.toolCall');
    case 'error':
      return i18n.t('thought.error');
    default:
      return i18n.t('thought.ai');
  }
}

/** 截断文本，超出长度时追加省略号 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 1) + '…';
}

/**
 * 将工具调用的参数格式化为可读摘要。
 * 按工具名提取关键参数，未知工具取第一个字符串值。
 */
export function getToolFriendlyFormat(
  toolName: string,
  toolInput?: Record<string, unknown>
): string {
  if (!toolInput) {
    return '';
  }

  switch (toolName) {
    case 'Bash':
      return typeof toolInput.command === 'string' ? toolInput.command : '';

    case 'Read':
      return typeof toolInput.file_path === 'string' ? toolInput.file_path : '';

    case 'Write':
      return typeof toolInput.file_path === 'string'
        ? `${toolInput.file_path} (new)`
        : '';

    case 'Edit':
      return typeof toolInput.file_path === 'string'
        ? `${toolInput.file_path} (edit)`
        : '';

    case 'Grep': {
      const pattern =
        typeof toolInput.pattern === 'string' ? `"${toolInput.pattern}"` : '';
      const path =
        typeof toolInput.path === 'string' ? ` in ${toolInput.path}` : '';
      return `Search ${pattern}${path}`;
    }

    case 'Glob':
      return typeof toolInput.pattern === 'string'
        ? `Match ${toolInput.pattern}`
        : '';

    case 'WebFetch': {
      if (typeof toolInput.url === 'string') {
        try {
          return new URL(toolInput.url).hostname.replace('www.', '');
        } catch {
          return toolInput.url;
        }
      }
      return '';
    }

    case 'WebSearch':
      return typeof toolInput.query === 'string'
        ? `Search: ${toolInput.query}`
        : '';

    default:
      for (const value of Object.values(toolInput)) {
        if (typeof value === 'string' && value.length > 0) {
          return truncateText(value, 80);
        }
      }
      return '';
  }
}
