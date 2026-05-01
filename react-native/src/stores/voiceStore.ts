/**
 * @file stores/voiceStore.ts
 * @description TTS 语音状态管理，负责语音开关、TTS 合成/播放流程控制
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import TrackPlayer, { Event, State } from 'react-native-track-player';
import RNFS from 'react-native-fs';
import Toast from 'react-native-toast-message';
import { cleanForTTS } from '../lib/tts-cleaner';
import { synthesize } from '../lib/tts';
import { getAudioPlayer } from '../lib/audio-player';
import {
  storage,
  getTtsApiKey,
  getTtsEnabled,
  saveTtsEnabled,
  getServerAddress,
} from '../storage/StorageUtils';
import { summarizeText } from '../api/server-api';

const SUMMARY_THRESHOLD = 200; // 写死的Summary阈值, 后面可以考虑放在设置中

const CACHE_DIR = `${RNFS.DocumentDirectoryPath}/tts_cache`;

interface VoiceStore {
  voiceEnabled: boolean;
  isSpeaking: boolean;

  toggleVoice: () => void;
  speak: (
    text: string,
    voiceId: string,
    agentId: string,
    sessionId: string
  ) => Promise<void>;
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
  console.log('[TTS] playback listener registered');

  // 添加音频播放状态监听
  TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
    if ('state' in event && event.state === State.Ended) {
      console.log('[TTS] playback ended');
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
        console.log(`[TTS] voice toggled: ${next ? 'enabled' : 'disabled'}`);
        set({ voiceEnabled: next });
        saveTtsEnabled(next);
        if (!next) {
          get().stopSpeaking();
        }
      },

      /**
       * 核心语音播报流程：
       * - 检查 API Key
       * - 清洗文本
       * - 长文本摘要
       * - TTS 合成
       * - 写文件
       * - 播放
       */
      speak: async (text, voiceId, agentId, sessionId) => {
        ensurePlaybackListener();
        console.log(
          `[TTS] speak called, textLen=${text.length}, voiceId=${voiceId}`
        );

        const apiKey = getTtsApiKey();
        if (!apiKey) {
          console.log('[TTS] no API Key, skip');
          Toast.show({
            type: 'info',
            text1: '请先在设置中配置 MiniMax API Key',
            position: 'bottom',
            visibilityTime: 2000,
          });
          return;
        }

        try {
          const cleaned = cleanForTTS(text);
          if (!cleaned.trim()) {
            console.log('[TTS] text empty after clean, skip');
            return;
          }

          let spokenText = cleaned;
          if (cleaned.length > SUMMARY_THRESHOLD) {
            console.log(
              `[TTS] text too long (${cleaned.length} chars), summarizing...`
            );
            try {
              const serverAddr = getServerAddress();
              spokenText = await summarizeText(
                serverAddr,
                agentId,
                sessionId,
                cleaned
              );
            } catch {
              console.log('[TTS] summarize failed, fallback to raw text');
            }
          }

          const audio = await synthesize(spokenText, voiceId, apiKey);
          console.log(`[TTS] synthesized, audio size=${audio.byteLength}`);

          const filePath = await writeAudioFile(audio);
          console.log(`[TTS] audio written to ${filePath}`);

          set({ isSpeaking: true });
          await getAudioPlayer().play(filePath);
          console.log('[TTS] playing...');
        } catch (err) {
          const message = err instanceof Error ? err.message : '语音播报失败';
          console.log(`[TTS] speak failed: ${message}`);
          Toast.show({
            type: 'error',
            text1: message,
            position: 'bottom',
            visibilityTime: 3000,
          });
        }
      },

      stopSpeaking: () => {
        console.log('[TTS] stopped');
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

// 初始化时从 StorageUtils 同步持久化的开关状态
const persisted = getTtsEnabled();
if (persisted) {
  useVoiceStore.setState({ voiceEnabled: true });
}
