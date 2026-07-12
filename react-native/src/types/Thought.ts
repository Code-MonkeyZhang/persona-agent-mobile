/** 思考过程的步骤类型 */
export type ThoughtType = 'thinking' | 'text' | 'tool_use' | 'error';

/** 单个思考步骤，构成结构化时间线的一个节点 */
export interface Thought {
  id: string;
  type: ThoughtType;
  /** thinking 文本 或 中间回复文本 */
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: { output: string; isError?: boolean };
  isError?: boolean;
}
