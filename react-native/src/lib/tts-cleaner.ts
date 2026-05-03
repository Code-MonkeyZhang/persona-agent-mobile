/**
 * @file lib/tts-cleaner.ts
 * @description 将 Markdown / HTML 等富文本清理为适合 TTS 朗读的纯净文本
 *
 * 清理策略：
 * - 去除 Markdown 语法（代码块、标题、粗斜体、链接、图片、列表标记）
 * - 去除 HTML 标签
 * - 去除 Emoji 及各类特殊符号
 * - 保留自然语言标点
 */

const EMOJI_REGEX =
  // eslint-disable-next-line no-misleading-character-class
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

export function cleanForTTS(text: string): string {
  let r = text;

  r = r.replace(/<[^>]+>/g, '');

  r = r.replace(/```[\s\S]*?```/g, '');
  r = r.replace(/`([^`]+)`/g, '$1');

  r = r.replace(/^#{1,6}\s+/gm, '');

  r = r.replace(/\*\*(.+?)\*\*/g, '$1');
  r = r.replace(/__(.+?)__/g, '$1');
  r = r.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '$1');
  r = r.replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1');

  r = r.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  r = r.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  r = r.replace(/^[\s]*[-*+]\s+/gm, '');
  r = r.replace(/^[\s]*\d+\.\s+/gm, '');

  r = r.replace(/&nbsp;/gi, ' ');
  r = r.replace(/&amp;/gi, '&');
  r = r.replace(/&lt;/gi, '<');
  r = r.replace(/&gt;/gi, '>');
  r = r.replace(/&quot;/gi, '"');
  r = r.replace(/&#\d+;/g, '');
  r = r.replace(/&\w+;/g, '');

  r = r.replace(EMOJI_REGEX, '');

  r = r.replace(/[~^|\\@#$%&=+<>{}[\]]/g, '');

  r = r.replace(/[ \t]+/g, ' ');
  r = r.replace(/\n{3,}/g, '\n\n');
  r = r.trim();

  return r;
}
