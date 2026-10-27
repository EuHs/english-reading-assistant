/* Web-app platform adapter for the shared core: AI and storage go through this server, TTS uses Kokoro. */
(function () {
  const TOKEN_KEY = 'era_token';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('era:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('era:' + k, JSON.stringify(v)); } catch (e) { /* quota */ } },
  };
  let audio = null;
  const ttsCache = new Map();

  window.WebP = {
    name: 'web',
    ls,
    token() { return localStorage.getItem(TOKEN_KEY) || ''; },
    setToken(t) { localStorage.setItem(TOKEN_KEY, t); },
    async getConfig() {
      const c = ERA.defaultConfig();
      c.ui = { ...c.ui, ...ls.get('ui', {}) };
      c.tts = { ...c.tts, ...ls.get('tts', {}) };
      c.ai = { active: 'server', profiles: [{ ...c.ai.profiles[0], id: 'server', name: '服务器 AI', type: 'server', model: '' }] };
      c.server = { ...c.server, enabled: true, autoSync: true, baseUrl: location.origin, apiToken: this.token() };
      return c;
    },
    async setConfig(c) { ls.set('ui', c.ui); ls.set('tts', c.tts); },
    // vocab/phrases live on the server; only annotations and the sync queue are kept locally
    async getData(k, d) { return k === 'vocab' || k === 'phrases' ? [] : ls.get(k, d); },
    async setData(k, v) { if (k !== 'vocab' && k !== 'phrases') ls.set(k, v); },
    async request(o) {
      try {
        const r = await fetch(o.url, { method: o.method || 'GET', headers: o.headers, body: o.body });
        return { ok: r.ok, status: r.status, text: await r.text() };
      } catch (e) { return { ok: false, status: 0, text: e.message }; }
    },
    async lookup(w) { try { return await ERA.serverCall('GET', '/api/dict/' + encodeURIComponent(w)); } catch (e) { return null; } },
    /** Kokoro offline TTS on the server; ERA.speak falls back to the browser voice if this throws. */
    async speak(text) {
      const voice = ls.get('kokoroVoice', '') || '';
      const speed = ls.get('tts', {}).rate || 1;
      const key = voice + '|' + speed + '|' + text;
      let url = ttsCache.get(key);
      if (!url) {
        const ctrl = new AbortController();
        const slow = setTimeout(() => ERA.UI && ERA.UI.toast('Kokoro 生成语音中（首次需加载模型）…', 2500), 1500);
        const t = setTimeout(() => ctrl.abort(), 25000);
        try {
          const r = await fetch(`/api/tts?text=${encodeURIComponent(text.slice(0, 600))}&voice=${encodeURIComponent(voice)}&speed=${speed}`, { headers: { Authorization: 'Bearer ' + this.token() }, signal: ctrl.signal });
          if (!r.ok) throw new Error('Kokoro 不可用');
          url = URL.createObjectURL(await r.blob());
          ttsCache.set(key, url);
        } finally { clearTimeout(slow); clearTimeout(t); }
      }
      if (audio) audio.pause();
      audio = new Audio(url);
      await audio.play();
    },
  };
})();
