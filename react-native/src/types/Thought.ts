/** 思考过程的步骤类型 */
export type ThoughtType = 'thinking' | 'text' | 'tool_use' | 'error';

/** 单个思考步骤，构成结构化时间线的一个节点 */
export interface Thought {
  id: string;
  type: ThoughtType;
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  /** 模型自写的本次调用短标题，显示取值链第一优先 */
  toolTitle?: string;
  /** 模型自写的本次调用意图，轮末收起行优先显示 */
  toolIntent?: string;
  toolResult?: { output: string; isError?: boolean };
  isError?: boolean;
}
