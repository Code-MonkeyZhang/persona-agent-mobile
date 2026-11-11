/**
 * @file contentBlocks.test.ts
 * @description 消息内容块与附件视图互转的直测，
 *   覆盖图片原始文件名的持久保存与历史块缺失时的回退。
 */
import {
  fromContentBlocks,
  toContentBlocks,
} from '../src/api/server-api.ts';
import { FileType, type FileInfo } from '../src/types/Chat.ts';

jest.mock('uuid', () => ({ v4: () => 'test-id' }));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/docs',
  CachesDirectoryPath: '/tmp/caches',
  mkdir: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  unlink: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  copyFile: jest.fn(() => Promise.resolve()),
  exists: jest.fn(() => Promise.resolve(false)),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve() })),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('react-native-device-info', () => ({ getUniqueId: () => 'test' }));
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString(): undefined {
      return undefined;
    }
    set(): void {}
    delete(): void {}
    getAllKeys(): string[] {
      return [];
    }
    contains(): boolean {
      return false;
    }
  },
}));

/** 已上传态的附件视图 */
function uploadedFile(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    id: 'a1',
    fileName: 'photo.png',
    url: 'file:///tmp/photo.png',
    fileSize: 100,
    format: 'png',
    type: FileType.image,
    width: 10,
    height: 10,
    status: 'uploaded',
    hash: 'f'.repeat(64),
    ...overrides,
  };
}

describe('图片原始文件名随消息持久保存', () => {
  it('组装内容块时图片块携带原始文件名', () => {
    const blocks = toContentBlocks('看图', [
      uploadedFile(),
      uploadedFile({
        id: 'a2',
        fileName: '报表.zip',
        type: FileType.document,
      }),
    ]) as Exclude<ReturnType<typeof toContentBlocks>, string>;
    expect(blocks[1]).toMatchObject({
      type: 'image',
      name: 'photo.png',
    });
    expect(blocks[2]).toMatchObject({ type: 'file', name: '报表.zip' });
  });

  it('解析回附件视图时优先采用块携带的文件名', () => {
    const { files } = fromContentBlocks(
      [
        {
          type: 'image',
          hash: 'a'.repeat(64),
          mimeType: 'image/jpeg',
          width: 8,
          height: 6,
          bytes: 20,
          name: '合照.jpeg',
        },
      ],
      'https://server.example'
    );
    expect(files[0]?.fileName).toBe('合照.jpeg');
  });

  it('历史图片块没有文件名时回退合成名', () => {
    const { files } = fromContentBlocks(
      [
        {
          type: 'image',
          hash: 'a'.repeat(64),
          mimeType: 'image/jpeg',
          width: 8,
          height: 6,
          bytes: 20,
        },
      ],
      'https://server.example'
    );
    expect(files[0]?.fileName).toBe('image.jpeg');
  });
});
