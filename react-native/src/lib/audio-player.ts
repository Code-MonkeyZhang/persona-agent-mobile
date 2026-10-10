/**
 * @file lib/audio-player.ts
 * @description 基于 expo-audio 的音频播放器封装
 * 替换式播放策略：新音频到来时停掉当前播放并立即播放新的
 * 使用 lazy 初始化，首次播放时才创建 Native 播放器实例
 */

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { logger } from './logger';

class AudioPlayerWrapper {
  private player: AudioPlayer | null = null;
  private onPlaybackEnd: (() => void) | null = null;

  get isPlaying(): boolean {
    return this.player?.playing ?? false;
  }

  /**
   * 注册播放结束回调，语音模块用它复位 isSpeaking 状态。
   */
  setOnPlaybackEnd(callback: () => void): void {
    this.onPlaybackEnd = callback;
  }

  /**
   * lazy 创建底层播放器，创建时挂接一次播放结束监听。
   */
  private ensurePlayer(): AudioPlayer {
    if (!this.player) {
      this.player = createAudioPlayer();
      this.player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          logger.debug('[Audio] playback finished');
          this.onPlaybackEnd?.();
        }
      });
      logger.debug('[Audio] player created');
    }
    return this.player;
  }

  /**
   * 播放本地音频文件，自动停掉当前正在播放的音频（替换式）
   * @param filePath - 本地音频文件路径（MP3 格式）
   */
  async play(filePath: string): Promise<void> {
    const uri = filePath.startsWith('file://')
      ? filePath
      : `file://${filePath}`;
    logger.debug('[Audio] play:', uri);
    const player = this.ensurePlayer();
    player.replace(uri);
    player.play();
  }

  /** 停止当前播放 */
  async stop(): Promise<void> {
    logger.debug('[Audio] stop');
    this.player?.pause();
  }
}

let _instance: AudioPlayerWrapper | null = null;

/** 获取 AudioPlayer 封装单例（lazy 初始化，首次调用时才创建） */
export function getAudioPlayer(): AudioPlayerWrapper {
  if (!_instance) {
    _instance = new AudioPlayerWrapper();
  }
  return _instance;
}
