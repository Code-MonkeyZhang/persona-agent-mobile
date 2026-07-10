/**
 * @file stores/voiceStore.ts
 * @description TTS 语音状态管理，负责语音开关、TTS 合成/播放流程控制
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import TrackPlayer, { Event, State } from 'react-native-track-player';
import RNFS from 'react-native-fs';
import Toast from 'react-native-toast-message';
import { synthesize } from '../lib/tts';
import { getAudioPlayer } from '../lib/audio-player';
import { logger } from '../lib/logger';
import {
  storage,
  getTtsEnabled,
  saveTtsEnabled,
} from '../storage/StorageUtils';

const CACHE_DIR = `${RNFS.DocumentDirectoryPath}/tts_cache`;

/** speak_ready 事件携带的 TTS 合成参数 */
export interface SpeakData {
  speakText: string;
  voiceId: string;
  apiKey: string;
  model: string;
  languageBoost?: string;
}

interface VoiceStore {
  voiceEnabled: boolean;
  isSpeaking: boolean;

  toggleVoice: () => void;
  speak: (data: SpeakData) => Promise<void>;
  stopSpeaking: () => void;
}

/**
 * 清理 tts_cache 目录下的旧缓存文件，确保每次播放前目录是干净的
 */
async function ensureCleanCacheDir(): Promise<string> {
  const exists = await RNFS.exists(CACHE_DIR);
  if (exists) {
    await RNFS.unlink(CACHE_DIR);
  }
  await RNFS.mkdir(CACHE_DIR);
  return CACHE_DIR;
}

/**
 * 将 ArrayBuffer 音频数据写入临时文件，返回文件路径
 */
async function writeAudioFile(audio: ArrayBuffer): Promise<string> {
  const cacheDir = await ensureCleanCacheDir();
  const filePath = `${cacheDir}/tts_${Date.now()}.mp3`;
  const base64 = arrayBufferToBase64(audio);
  await RNFS.writeFile(filePath, base64, 'base64');
  return filePath;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * lazy 注册 TrackPlayer 播放结束监听器。
 * 必须在 setupPlayer() 之后调用，否则 Native Module 尚未就绪会崩溃。
 */
let _listenerRegistered = false;
export function ensurePlaybackListener(): void {
  if (_listenerRegistered) {
    return;
  }

  _listenerRegistered = true;
  logger.info('[TTS] playback listener registered');

  TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
    if ('state' in event && event.state === State.Ended) {
      logger.debug('[TTS] playback ended');
      useVoiceStore.setState({ isSpeaking: false });
    }
  });
}

export const useVoiceStore = create<VoiceStore>()(
  persist(
    (set, get) => ({
      voiceEnabled: false,
      isSpeaking: false,

      toggleVoice: () => {
        const next = !get().voiceEnabled;
        logger.info(`[TTS] voice toggled: ${next ? 'enabled' : 'disabled'}`);
        set({ voiceEnabled: next });
        saveTtsEnabled(next);
        if (!next) {
          get().stopSpeaking();
        }
      },

      /**
       * 核心语音播报流程（简化版）：
       * 文本已由服务端清洗/压缩/翻译，直接合成 → 写文件 → 播放。
       */
      speak: async (data) => {
        ensurePlaybackListener();
        logger.info(
          `[TTS] speak called, textLen=${data.speakText.length}, voiceId=${data.voiceId}`
        );

        try {
          const audio = await synthesize(
            data.speakText,
            data.voiceId,
            data.apiKey,
            data.model,
            data.languageBoost
          );
          logger.debug(`[TTS] synthesized, audio size=${audio.byteLength}`);

          const filePath = await writeAudioFile(audio);
          logger.debug(`[TTS] audio written to ${filePath}`);

          set({ isSpeaking: true });
          await getAudioPlayer().play(filePath);
          logger.debug('[TTS] playing...');
        } catch (err) {
          const message = err instanceof Error ? err.message : '语音播报失败';
          logger.error(`[TTS] speak failed: ${message}`);
          Toast.show({
            type: 'error',
            text1: message,
            position: 'bottom',
            visibilityTime: 3000,
          });
        }
      },

      stopSpeaking: () => {
        logger.info('[TTS] stopped');
        getAudioPlayer().stop();
        set({ isSpeaking: false });
      },
    }),
    {
      name: 'voice-store',
      storage: createJSONStorage(() => ({
        getItem: (name: string) => storage.getString(name) ?? null,
        setItem: (name: string, value: string) => storage.set(name, value),
        removeItem: (name: string) => storage.delete(name),
      })),
      partialize: (state) => ({
        voiceEnabled: state.voiceEnabled,
      }),
    }
  )
);

const persisted = getTtsEnabled();
if (persisted) {
  useVoiceStore.setState({ voiceEnabled: true });
}
