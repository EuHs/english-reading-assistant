/* Local vocab / phrase book, server sync queue, TTS. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.Store = {
  async words() { return (await ERA.P.getData('vocab', [])) || []; },
  async phrases() { return (await ERA.P.getData('phrases', [])) || []; },

  /** payload: server word payload (see server README). Dedupes by lemma; different articles become occurrences. */
  async addWord(payload) {
    const list = await this.words();
    const lemma = (payload.lemma || payload.word).toLowerCase();
    let e = list.find((x) => x.lemma === lemma);
    const occ = { surface: payload.word, sentence: payload.sentence, sentence_translation: payload.sentence_translation, article: payload.article, added: new Date().toISOString() };
    if (!e) {
      e = { id: ERA.uid(), lemma, created: occ.added, occurrences: [] };
      list.unshift(e);
    }
    Object.assign(e, {
      word: e.word || payload.word, phonetic: payload.phonetic || e.phonetic, translation: payload.translation || e.translation,
      meaning: payload.meaning || e.meaning, pos: payload.pos || e.pos, morphology: payload.morphology || e.morphology,
      roots: payload.roots && payload.roots.length ? payload.roots : e.roots, forms: payload.forms || e.forms, tenses: payload.tenses || e.tenses,
      etymology: payload.etymology || e.etymology,
    });
    if (!e.occurrences.some((o) => o.sentence === occ.sentence && o.article && occ.article && o.article.url === occ.article.url)) e.occurrences.push(occ);
    await ERA.P.setData('vocab', list);
    return this.enqueue('word', payload);
  },

  async addPhrase(payload) {
    const list = await this.phrases();
    if (!list.some((x) => x.text === payload.text && x.article && payload.article && x.article.url === payload.article.url)) {
      list.unshift({ id: ERA.uid(), created: new Date().toISOString(), ...payload });
      await ERA.P.setData('phrases', list);
    }
    return this.enqueue('phrase', payload);
  },

  async removeWord(id) { await ERA.P.setData('vocab', (await this.words()).filter((x) => x.id !== id)); },
  async removePhrase(id) { await ERA.P.setData('phrases', (await this.phrases()).filter((x) => x.id !== id)); },

  async enqueue(kind, payload) {
    const cfg = await ERA.P.getConfig();
    if (!cfg.server.enabled || !cfg.server.autoSync) return { synced: false, reason: 'server-disabled' };
    const q = (await ERA.P.getData('syncQueue', [])) || [];
    q.push({ id: ERA.uid(), kind, payload });
    await ERA.P.setData('syncQueue', q);
    return this.flush(cfg);
  },

  /** Push queued items to the server; keeps failures for the next attempt. */
  async flush(cfgIn) {
    const cfg = cfgIn || (await ERA.P.getConfig());
    if (!cfg.server.enabled) return { synced: false, reason: 'server-disabled' };
    const q = (await ERA.P.getData('syncQueue', [])) || [];
    const left = [];
    let ok = 0, lastErr = '';
    for (const item of q) {
      try {
        await ERA.serverCall('POST', item.kind === 'word' ? cfg.server.endpoints.words : cfg.server.endpoints.phrases, item.payload, cfg);
        ok++;
      } catch (e) { lastErr = e.message; left.push(item); }
    }
    await ERA.P.setData('syncQueue', left);
    return { synced: left.length === 0, ok, pending: left.length, error: lastErr };
  },

  async exportAll() {
    return JSON.stringify({ type: 'era-book', exportedAt: new Date().toISOString(), words: await this.words(), phrases: await this.phrases() }, null, 2);
  },

  toCSV(words) {
    const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const rows = [['word', 'lemma', 'phonetic', 'translation', 'roots', 'sentence', 'sentence_translation', 'title', 'author', 'published', 'url']];
    for (const w of words) for (const o of w.occurrences || [{}]) {
      const a = o.article || {};
      rows.push([w.word, w.lemma, w.phonetic, w.translation, (w.roots || []).join(' '), o.sentence, o.sentence_translation, a.title, a.author, a.published_at, a.url]);
    }
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n');
  },
};

/* ---------- TTS (browser speechSynthesis, platform may override, e.g. web app Kokoro) ---------- */
ERA.speak = async function (text) {
  text = String(text || '').trim();
  if (!text) return;
  if (ERA.P && ERA.P.speak) {
    try { return await ERA.P.speak(text); } catch (e) { /* fall back to browser voice */ }
  }
  const ss = globalThis.speechSynthesis;
  if (!ss) throw new Error('此浏览器不支持语音朗读');
  const cfg = await ERA.P.getConfig();
  ss.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = cfg.tts.lang || 'en-US';
  u.rate = +cfg.tts.rate || 0.95;
  const voices = ss.getVoices();
  u.voice = voices.find((v) => v.name === cfg.tts.voice) || voices.find((v) => v.lang === u.lang && /Google|Samantha|Microsoft|Daniel|Karen/i.test(v.name)) || voices.find((v) => v.lang.startsWith('en')) || null;
  ss.speak(u);
};
