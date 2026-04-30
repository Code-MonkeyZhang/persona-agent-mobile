/**
 * @file lib/tts.ts
 * @description MiniMax TTS API 封装，通过原生 fetch 调用语音合成接口
 */

const TTS_API_URL = 'https://api.minimaxi.com/v1/t2a_v2';
const TTS_MODEL = 'speech-2.8-hd';

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<ArrayBuffer> {
  const resp = await fetch(TTS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      text,
      stream: false,
      voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, format: 'mp3' },
    }),
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
