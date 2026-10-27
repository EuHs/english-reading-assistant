// Kokoro-82M offline TTS (kokoro-js, ONNX on CPU). The model downloads once into data/models, then runs fully offline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VOICES = [
  ['af_heart', '美式女声 Heart'], ['af_bella', '美式女声 Bella'], ['af_nicole', '美式女声 Nicole'], ['af_sarah', '美式女声 Sarah'],
  ['am_michael', '美式男声 Michael'], ['am_fenrir', '美式男声 Fenrir'], ['am_puck', '美式男声 Puck'],
  ['bf_emma', '英式女声 Emma'], ['bf_isabella', '英式女声 Isabella'], ['bm_george', '英式男声 George'], ['bm_fable', '英式男声 Fable'],
];

export class TTS {
  constructor({ dataDir, enabled, dtype, hfEndpoint }) {
    this.enabled = enabled;
    this.dtype = dtype || 'q8';
    this.cacheDir = path.join(dataDir, 'tts');
    this.modelDir = path.join(dataDir, 'models');
    this.hfEndpoint = hfEndpoint;
    this.model = null;
    this.loading = null;
    this.error = null;
    this.chain = Promise.resolve(); // one synthesis at a time keeps memory bounded
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  status() { return { enabled: this.enabled, ready: !!this.model, loading: !!this.loading && !this.model, error: this.error }; }

  load() {
    if (!this.enabled) return Promise.reject(new Error('TTS 未启用（ENABLE_TTS=1）'));
    if (this.model) return Promise.resolve(this.model);
    this.loading = this.loading || (async () => {
      try {
        const tf = await import('@huggingface/transformers');
        tf.env.cacheDir = this.modelDir;
        if (this.hfEndpoint) tf.env.remoteHost = this.hfEndpoint.replace(/\/?$/, '/');
        const { KokoroTTS } = await import('kokoro-js');
        this.model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: this.dtype, device: 'cpu' });
        this.error = null;
        return this.model;
      } catch (e) {
        this.error = e.message;
        this.loading = null;
        throw e;
      }
    })();
    return this.loading;
  }

  async speak(text, voice = 'af_heart', speed = 1) {
    text = String(text || '').trim().slice(0, 600);
    if (!text) throw new Error('text 为空');
    if (!VOICES.some(([v]) => v === voice)) voice = 'af_heart';
    speed = Math.min(1.5, Math.max(0.6, +speed || 1));
    const key = crypto.createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex');
    const file = path.join(this.cacheDir, key + '.wav');
    if (fs.existsSync(file)) return file;
    const model = await this.load();
    const run = this.chain.then(async () => {
      const audio = await model.generate(text, { voice, speed });
      await audio.save(file);
      return file;
    });
    this.chain = run.catch(() => {});
    return run;
  }
}
