/**
 * @file lib/audio-player.ts
 * @description 基于 react-native-track-player 的音频播放器封装
 * 替换式播放策略：新音频到来时停掉当前播放并立即播放新的
 * 使用 lazy 初始化，避免模块加载时 Native Module 尚未就绪
 */

import TrackPlayer from 'react-native-track-player';
import { logger } from './logger';

class AudioPlayer {
  private playing = false;

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * 播放本地音频文件，自动停掉当前正在播放的音频（替换式）
   * @param filePath - 本地音频文件路径（MP3 格式）
   */
  async play(filePath: string): Promise<void> {
    logger.debug('[Audio] play:', filePath);
    await this.stop();
    await TrackPlayer.add({ url: filePath });
    await TrackPlayer.play();
    this.playing = true;
  }

  /** 停止当前播放并重置队列 */
  async stop(): Promise<void> {
    logger.debug('[Audio] stop');
    await TrackPlayer.reset();
    this.playing = false;
  }
}

let _instance: AudioPlayer | null = null;

/** 获取 AudioPlayer 单例（lazy 初始化，首次调用时才创建） */
export function getAudioPlayer(): AudioPlayer {
  if (!_instance) {
    _instance = new AudioPlayer();
  }
  return _instance;
}
