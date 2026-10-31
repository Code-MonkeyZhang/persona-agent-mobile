/**
 * @file __tests__/logger.test.ts
 * @description 日志文件清单的直测，假 RNFS 读目录，
 *   覆盖非日志文件过滤、按文件名日期新到旧排序与目录读取失败回退空清单。
 */
import { logger } from '../src/lib/logger';
import RNFS from 'react-native-fs';

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: { DocumentDirectoryPath: '/docs', readDir: jest.fn() },
}));

const readDir = RNFS.readDir as unknown as jest.Mock;

/** 目录项替身，listFiles 只消费 name 与 path */
function makeFile(name: string) {
  return { name, path: `/docs/logs/${name}` };
}

test('listFiles 只收 app 日期命名的文件并按日期新到旧排序', async () => {
  readDir.mockResolvedValue([
    makeFile('app-2026-10-22.log'),
    makeFile('not-a-log.txt'),
    makeFile('app-2026-10-24.log'),
    makeFile('app-2026-10-23.log'),
  ]);
  await expect(logger.listFiles()).resolves.toEqual([
    '/docs/logs/app-2026-10-24.log',
    '/docs/logs/app-2026-10-23.log',
    '/docs/logs/app-2026-10-22.log',
  ]);
});

test('listFiles 目录读取失败回退空清单', async () => {
  readDir.mockRejectedValue(new Error('no such directory'));
  await expect(logger.listFiles()).resolves.toEqual([]);
});
