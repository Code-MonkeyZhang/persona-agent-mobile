/**
 * @file 陪伴演出状态库，PerformanceEngine 的 zustand 薄绑定与移动端的依赖装配
 * 取图走 imageCache 的哈希链路，清单网络优先失败回退 MMKV，立绘就绪信号是文件落盘
 * 气泡是包内资源随取随有，不经缓存解析，淡入交给图片组件自己
 */
import { create } from 'zustand';
import { Image } from 'react-native';
import {
  fetchPoses,
  getPoseImageUrl,
  notePoseAssets,
  type PoseAssets,
} from '../api/server-api.ts';
import { imageCache } from '../storage/image-cache-rn.ts';
import {
  getPosesAssets,
  getServerAddress,
  getServerAgentId,
  savePosesAssets,
} from '../storage/StorageUtils.ts';
import type { BubbleName, ShowPoseParams } from '../lib/performance.ts';
import { logger } from '../lib/logger';
import {
  INITIAL_STATE,
  PerformanceEngine,
  type GeneratingPhase,
  type PerformanceLog,
  type PerformanceState,
} from './performanceEngine.ts';

/** 立绘清单按 Agent 缓存，值是在途或已完成的请求，同一 Agent 只走一次网络 */
const catalogs = new Map<string, Promise<PoseAssets>>();

/**
 * 取指定 Agent 的立绘与背景清单，网络优先，失败回退 MMKV 里的上次清单
 * 网络结果落 MMKV 供离线使用，两条路径都把哈希登记进取图地址表
 * @param agentId - Agent 标识
 * @param fresh - 为真时丢掉缓存重拉，用于清单之后新增的立绘
 * @returns 立绘哈希清单与背景哈希
 */
export function loadCatalog(
  agentId: string,
  fresh = false
): Promise<PoseAssets> {
  if (fresh) catalogs.delete(agentId);
  let request = catalogs.get(agentId);
  if (!request) {
    request = fetchPoses(agentId, getServerAddress())
      .then((assets) => {
        savePosesAssets(agentId, assets);
        return assets;
      })
      .catch(() => {
        const cached = getPosesAssets(agentId);
        if (!cached) {
          throw new Error('pose catalog unavailable');
        }
        notePoseAssets(agentId, cached);
        logger.info('[Companion] poses loaded from local cache');
        return cached;
      })
      .catch((error: unknown) => {
        catalogs.delete(agentId);
        throw error;
      });
    catalogs.set(agentId, request);
  }
  return request;
}

/** 按立绘名解析带哈希的图片地址，清单里没有这个名字时重拉一次清单再试 */
async function resolvePose(pose: string): Promise<string | null> {
  const agentId = getServerAgentId();
  if (!agentId) {
    return null;
  }
  const known = (assets: PoseAssets) =>
    assets.poses.some((item) => item.name === pose);
  try {
    let assets = await loadCatalog(agentId);
    if (!known(assets)) {
      logger.info('[performance] pose hash missing, refetch catalog');
      assets = await loadCatalog(agentId, true);
    }
    return known(assets)
      ? getPoseImageUrl(agentId, pose, getServerAddress())
      : null;
  } catch (error) {
    logger.warn('[performance] catalog load failed', error);
    return null;
  }
}

/**
 * 立绘就绪门控，先把地址落成本地文件再读自然尺寸，任一步失败即未就绪
 * 缓存返回的是不带协议的纯文件路径，读尺寸的原生接口不像 Image 组件那样做路径规范化，
 * 只认带 file 协议的地址，纯路径原样传入会报不支持的协议
 */
async function decodeImage(
  url: string
): Promise<{ width: number; height: number }> {
  const local = await imageCache.resolve(url);
  if (!local) {
    throw new Error('pose not cached');
  }
  const uri = local.startsWith('file://') ? local : `file://${local}`;
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

interface PerformanceStore extends PerformanceState {
  /** pose_changed 事件的入口，带门控淡化 */
  perform: (params: ShowPoseParams) => void;
  /** 会话恢复的瞬切，跳过淡化 */
  restore: (pose: string) => void;
  /** 生成相位的入口，思考气泡随之出入场 */
  setPhase: (phase: GeneratingPhase) => void;
  /** 思考气泡开关的入口，引擎不读设置库，由舞台的桥接注入 */
  setThinkingEnabled: (enabled: boolean) => void;
  motionEnded: () => void;
}

export const usePerformanceStore = create<PerformanceStore>((set) => {
  const log: PerformanceLog = {
    info: (message, detail) => logger.info(`[performance] ${message}`, detail),
    warn: (message, detail) => logger.warn(`[performance] ${message}`, detail),
  };
  const engine = new PerformanceEngine<ReturnType<typeof setTimeout>>(
    {
      resolvePose,
      decodeImage,
      // 气泡是包内资源，没有预解码环节，淡入由图片组件在加载完成时自己接管
      preloadBubble: (_name: BubbleName) => Promise.resolve(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle),
      now: Date.now,
      log,
    },
    set
  );

  return {
    ...INITIAL_STATE,
    perform: (params) => engine.perform(params),
    restore: (pose) => engine.restore(pose),
    setPhase: (phase) => engine.setPhase(phase),
    setThinkingEnabled: (enabled) => engine.setThinkingEnabled(enabled),
    motionEnded: () => engine.motionEnded(),
  };
});
