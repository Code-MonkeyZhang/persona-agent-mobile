import { Tokenizer } from 'marked';
import type { Tokens } from 'marked';

export class CustomTokenizer extends Tokenizer {
  /**
   * 修复流式输出时末尾出现的不完整列表标记
   * - 末尾孤立的 "-" 或 "- " 会被替换为 "*" 以保证列表正常渲染
   */
  list(src: string): Tokens.List | undefined {
    const len = src.length;
    if (len < 4) {
      return super.list(src);
    }
    if (
      (src[len - 1] === '-' && src[len - 2] === ' ' && src[len - 3] === ' ') ||
      (src[len - 1] === ' ' &&
        src[len - 2] === '-' &&
        src[len - 3] === ' ' &&
        src[len - 4] === ' ')
    ) {
      const position = src[len - 1] === '-' ? len - 1 : len - 2;
      return super.list(src.slice(0, position) + '*' + src.slice(position + 1));
    }
    return super.list(src);
  }
}
