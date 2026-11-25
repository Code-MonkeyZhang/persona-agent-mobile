/**
 * @file effectAssets.test.ts
 * @description 气泡资源索引与名单的一致性，加图漏登记、改名漏同步、导入路径写错都在这里报出。
 *   webp 经通配声明通过类型检查，又经 jest 的图片映射变成桩，
 *   导入路径是否指向真实文件只有 Metro 在打包时才解析，这条用例把那份检查提前到单测里。
 *   气泡层的键集是情绪气泡名单加思考气泡，思考气泡不进名单但仍随包携带。
 */
import { EFFECT_ASSETS } from '../src/lib/effect-assets';
import {
  BUBBLE_NAMES,
  THINKING_BUBBLE,
  type LayerBubbleName,
} from '../src/lib/performance';

/** 气泡层的全部名字，情绪气泡名单加思考气泡 */
const LAYER_NAMES: LayerBubbleName[] = [...BUBBLE_NAMES, THINKING_BUBBLE];

/** 项目 tsconfig 不含 node 类型，文件系统经 requireActual 取用，只声明用到的方法 */
const fs = jest.requireActual('fs') as {
  existsSync(file: string): boolean;
  readFileSync(file: string, encoding: 'utf8'): string;
};
const path = jest.requireActual('path') as {
  resolve(...parts: string[]): string;
};

/** 本文件在工程的 __tests__ 下，往上两层是工程根，索引源码在它的 src/lib 里 */
const libDir = path.resolve(
  expect.getState().testPath ?? '',
  '..',
  '..',
  'src',
  'lib'
);

describe('effect-assets 索引', () => {
  it('键集是情绪气泡名单加思考气泡，加图漏登记当场拦截', () => {
    expect(Object.keys(EFFECT_ASSETS).sort()).toEqual([...LAYER_NAMES].sort());
  });

  it('每个键都解析到了资源', () => {
    const assets = Object.values(EFFECT_ASSETS);
    expect(assets).toHaveLength(LAYER_NAMES.length);
    expect(assets.every((asset) => Boolean(asset))).toBe(true);
  });

  it('每条 webp 导入路径都指向磁盘上的真实文件，条数与气泡层键集相等', () => {
    const source = fs.readFileSync(
      path.resolve(libDir, 'effect-assets.ts'),
      'utf8'
    );
    const specifiers = [...source.matchAll(/from '([^']+\.webp)'/g)].map(
      (match) => match[1]
    );
    expect(specifiers).toHaveLength(LAYER_NAMES.length);
    for (const specifier of specifiers) {
      expect(fs.existsSync(path.resolve(libDir, specifier))).toBe(true);
    }
  });
});
