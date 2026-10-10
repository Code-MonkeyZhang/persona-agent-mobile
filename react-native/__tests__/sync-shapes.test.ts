/**
 * @file __tests__/sync-shapes.test.ts
 * @description 抄录层纯函数的单测，覆盖边界混入、预览派生与镜像投影。
 */
import {
  buildPreviewText,
  deriveSessionPreview,
  mixTurnEnds,
  toServerChatMessages,
  type Message,
} from '../src/storage/sync-shapes';

test('mixTurnEnds 无边界时原样返回', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ];
  expect(mixTurnEnds(messages, undefined)).toBe(messages);
  expect(mixTurnEnds(messages, [])).toBe(messages);
});

test('mixTurnEnds 按消息数把边界条目混入对应位置', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'again' },
    { role: 'assistant', content: 'world' },
  ];
  const mixed = mixTurnEnds(messages, [2]);
  expect(mixed.length).toBe(5);
  expect(mixed[2]).toEqual({ role: 'system', content: '', turnEnd: true });
  expect(mixed[4]).toEqual({ role: 'assistant', content: 'world' });
});

test('deriveSessionPreview 从尾部取最近的用户或助手文本', () => {
  const messages: Message[] = [
    { role: 'user', content: '问题' },
    { role: 'assistant', tool_calls: [] },
    { role: 'system', content: '标记' },
    { role: 'assistant', content: '回答正文' },
  ];
  expect(deriveSessionPreview(messages)).toBe('回答正文');
});

test('deriveSessionPreview 展平 user 内容块数组并截断长文本', () => {
  const long = 'a'.repeat(100);
  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: long },
        { type: 'text', text: 'tail' },
      ],
    },
  ];
  expect(deriveSessionPreview(messages)).toBe(buildPreviewText(long + 'tail'));
  expect(deriveSessionPreview(messages)?.length).toBe(80);
});

test('toServerChatMessages 投影 user 内容块、assistant 工具与 system 边界', () => {
  const toolCalls = [
    {
      id: 't1',
      type: 'function',
      function: { name: 'show_pose', arguments: { pose: 'happy' } },
      toolResult: { content: 'ok', isError: false },
    },
  ];
  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '块一' },
        { type: 'text', text: '块二' },
      ],
    },
    {
      role: 'assistant',
      content: '回答',
      thinking: '思路',
      tool_calls: toolCalls,
    },
    { role: 'system', content: '', turnEnd: true },
    { role: 'app_notification', source: 'app', content: '通知' },
  ];
  const projected = toServerChatMessages(messages);
  expect(projected[0]).toEqual({ role: 'user', content: '块一块二' });
  expect(projected[1]).toEqual({
    role: 'assistant',
    content: '回答',
    thinking: '思路',
    tool_calls: toolCalls,
  });
  expect(projected[2]).toEqual({ role: 'system', content: '', turnEnd: true });
  expect(projected[3]).toEqual({ role: 'app_notification', content: '通知' });
});
