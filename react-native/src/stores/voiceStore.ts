/**
 * @file stores/voiceStore.ts
 * @description 语音状态机，意图、能力、动画三样状态收口于此
 *
 * voiceEnabled 表达想不想听，MMKV 持久化；
 * voiceReady 缓存能力是否齐备，由点击现查与 speak 事件回写；
 * speakStage 驱动图标动画，回合结束点亮，出声转播报色，播完收回。
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import RNFS from 'react-native-fs';
import Toast from 'react-native-toast-message';
import { synthesize } from '../lib/tts';
import { getAudioPlayer } from '../lib/audio-player';
import { fetchAgentDetail, fetchTtsConfig } from '../api/server-api';
import type { SpeakErrorReason } from '../api/server-api';
import {
  listMissing,
  missingToI18nKey,
  reasonToMissing,
  shouldNotifyOnDowngrade,
} from '../lib/voice-readiness';
import {
  storage,
  getServerAddress,
  getServerAgentId,
  getTtsEnabled,
  saveTtsEnabled,
} from '../storage/StorageUtils';
import { logger } from '../lib/logger';
import i18n from '../i18n/index.ts';

const CACHE_DIR = `${RNFS.DocumentDirectoryPath}/tts_cache`;

/** speak_ready 事件携带的 TTS 合成参数 */
export interface SpeakData {
  speakText: string;
  voiceId: string;
  apiKey: string;
  model: string;
  languageBoost?: string;
}

/** 播报动画三段，空闲无动画，点亮表语音生成中，跳动段表正在出声 */
export type SpeakStage = 'idle' | 'pending' | 'speaking';

interface VoiceStore {
  /** 意图，想不想听 */
  voiceEnabled: boolean;
  /** 能力缓存，null 未查 true 齐备 false 缺失 */
  voiceReady: boolean | null;
  /** 动画段 */
  speakStage: SpeakStage;

  toggleVoice: () => Promise<void>;
  refreshCapability: (notify: boolean) => Promise<boolean>;
  noteChatSent: (voiceEnabled: boolean, sessionId: string) => void;
  noteRoundEnded: (sessionId: string) => void;
  noteSpeakError: (reason: SpeakErrorReason) => void;
  clearSpeakStage: () => void;
  speak: (data: SpeakData) => Promise<void>;
  stopSpeaking: () => void;
}

/** 本机发起且开着语音的回合，等待动画只认这个会话 */
let awaitVoiceSessionId: string | null = null;

function showWarn(text: string) {
  Toast.show({ type: 'warn', text1: text });
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
 * 将 ArrayBuffer 音频数据写入临时文件，返回文件路径。
 * 聊天语音与详情页试听共用，写前清空缓存目录保证不留旧文件。
 */
export async function writeAudioFile(audio: ArrayBuffer): Promise<string> {
  const cacheDir = await ensureCleanCacheDir();
  const filePath = `${cacheDir}/tts_${Date.now()}.mp3`;
  const base64 = arrayBufferToBase64(audio);
  await RNFS.writeFile(filePath, base64, 'base64');
  return filePath;
}

/** RN 运行时提供 btoa，类型层面局部声明，避免依赖 DOM 库 */
declare const btoa: (data: string) => string;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const useVoiceStore = create<VoiceStore>()(
  persist(
    (set, get) => ({
      voiceEnabled: false,
      voiceReady: null,
      speakStage: 'idle',

      /**
       * 切换语音开关。开启前现查能力，缺口当场弹引导；关闭时停播并收动画。
       */
      toggleVoice: async () => {
        const next = !get().voiceEnabled;
        if (!next) {
          logger.info('[TTS] voice toggled: disabled');
          get().stopSpeaking();
          set({ voiceEnabled: false });
          saveTtsEnabled(false);
          return;
        }
        await get().refreshCapability(true);
        set({ voiceEnabled: true });
        saveTtsEnabled(true);
        logger.info('[TTS] voice toggled: enabled', {
          ready: get().voiceReady,
        });
      },

      /**
       * 现查能力并回写 voiceReady。notify 为真时按缺口逐条弹引导，供点击开启用；
       * 静默路径供连接恢复后补查，只定图标视觉态不打扰。
       */
      refreshCapability: async (notify) => {
        let hasKey = false;
        let hasVoice = false;
        const address = getServerAddress();
        const agentId = getServerAgentId();
        if (address && agentId) {
          try {
            hasKey = !!(await fetchTtsConfig(address)).apiKey;
          } catch (err) {
            logger.warn(`[TTS] key check failed: ${err}`);
          }
          try {
            hasVoice = !!(await fetchAgentDetail(address, agentId)).voiceId;
          } catch (err) {
            logger.warn(`[TTS] agent check failed: ${err}`);
          }
        }
        const missing = listMissing({ hasKey, hasVoice });
        const next = missing.length === 0;
        set({ voiceReady: next });
        if (notify) {
          missing.forEach((m) => showWarn(i18n.t(missingToI18nKey(m))));
        }
        logger.info('[TTS] capability checked', {
          hasKey,
          hasVoice,
          ready: next,
          notify,
        });
        return next;
      },

      /**
       * 发消息时登记，只有本机发起且开着语音的回合才点亮等待动画。
       */
      noteChatSent: (voiceEnabled, sessionId) => {
        awaitVoiceSessionId = voiceEnabled ? sessionId : null;
      },

      /**
       * 回合结束，登记的会话对得上且能力未判缺失就点亮图标，覆盖整段生成等待。
       */
      noteRoundEnded: (sessionId) => {
        if (sessionId !== awaitVoiceSessionId) return;
        awaitVoiceSessionId = null;
        if (!get().voiceEnabled || get().voiceReady === false) return;
        set({ speakStage: 'pending' });
        logger.info(`[TTS] round ended, pending lit, session=${sessionId}`);
      },

      /**
       * speak_error 回写。配置类缺口转警示态，边沿触发只在就绪跌缺失那一次提醒；
       * no_content 收掉动画静默返回。
       */
      noteSpeakError: (reason) => {
        const missing = reasonToMissing(reason);
        if (!missing) {
          set({ speakStage: 'idle' });
          return;
        }
        const prev = get().voiceReady;
        set({ voiceReady: false, speakStage: 'idle' });
        if (shouldNotifyOnDowngrade(prev, false)) {
          showWarn(i18n.t(missingToI18nKey(missing)));
        }
        logger.info(`[TTS] speak_error handled, reason=${reason} prev=${prev}`);
      },

      clearSpeakStage: () => set({ speakStage: 'idle' }),

      /**
       * 核心语音播报流程：文本已由服务端清洗压缩，直连合成 → 写文件 → 播放。
       * 合成期间保持点亮段，真正出声由播放器开始回调转播报段，
       * 任何一步失败弹错误提示并收动画，图标态不动。
       */
      speak: async (data) => {
        logger.info(
          `[TTS] speak called, textLen=${data.speakText.length}, voiceId=${data.voiceId}`
        );
        try {
          set({ voiceReady: true });
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
          getAudioPlayer().play(filePath);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : i18n.t('error.ttsFailed');
          logger.error(`[TTS] speak failed: ${message}`);
          set({ speakStage: 'idle' });
          Toast.show({ type: 'error', text1: message });
        }
      },

      stopSpeaking: () => {
        logger.info('[TTS] stopped');
        awaitVoiceSessionId = null;
        getAudioPlayer().stop();
        set({ speakStage: 'idle' });
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

/**
 * 播放器开始与结束回调在模块加载时挂接一次，驱动动画段在播报与空闲间切换。
 */
getAudioPlayer().setPlaybackCallbacks({
  onStart: () => useVoiceStore.setState({ speakStage: 'speaking' }),
  onEnd: () => useVoiceStore.setState({ speakStage: 'idle' }),
});
