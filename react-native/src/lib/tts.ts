/**
 * @file lib/tts.ts
 * @description MiniMax TTS API 封装，通过原生 fetch 调用语音合成接口
 */

const TTS_API_URL = 'https://api.minimaxi.com/v1/t2a_v2';

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

/**
 * 调用 MiniMax T2A_V2 接口合成语音。
 * @param text 待合成文本（已由服务端清洗/压缩/翻译）
 * @param voiceId 音色 ID
 * @param apiKey MiniMax API Key（由服务端下发）
 * @param model TTS 模型，默认 'speech-2.8-hd'
 * @param languageBoost 语言增强，可选值: 'Chinese' | 'English' | 'Japanese'
 */
export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string,
  model?: string,
  languageBoost?: string
): Promise<ArrayBuffer> {
  const body: Record<string, unknown> = {
    model: model || 'speech-2.8-hd',
    text,
    stream: false,
    voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, format: 'mp3' },
  };

  if (languageBoost) {
    body.language_boost = languageBoost;
  }

  const resp = await fetch(TTS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`TTS API failed: ${resp.status}`);
  }

  const data = await resp.json();
  if (data.base_resp.status_code !== 0) {
    throw new Error(`TTS error: ${data.base_resp.status_msg}`);
  }

  return hexToArrayBuffer(data.data.audio);
}
