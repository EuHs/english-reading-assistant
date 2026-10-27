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

  /** Delete a whole entry from the book (book panel / options page); also deleted on the server. */
  async removeWord(id) {
    const list = await this.words();
    const e = list.find((x) => x.id === id);
    await ERA.P.setData('vocab', list.filter((x) => x.id !== id));
    if (e) return this.enqueue('unword', { lemma: e.lemma });
  },
  async removePhrase(id) {
    const list = await this.phrases();
    const e = list.find((x) => x.id === id);
    await ERA.P.setData('phrases', list.filter((x) => x.id !== id));
    if (e) return this.enqueue('unphrase', { text: e.text });
  },

  normPhrase: (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[\s"'“”‘’.,;:!?]+$/g, '').replace(/^[\s"'“”‘’]+/, ''),

  /** Bookmark-style state on the current article: 'none' | 'other' (saved from another article) | 'here'. */
  async wordState(lemma, url) {
    lemma = String(lemma || '').toLowerCase();
    if (ERA.P.remoteBook) {
      const r = await ERA.serverCall('POST', '/api/book/status', { words: [lemma], article_url: url });
      return r.words[lemma].state;
    }
    const e = (await this.words()).find((x) => x.lemma === lemma);
    if (!e) return 'none';
    return (e.occurrences || []).some((o) => o.article && o.article.url === url) ? 'here' : 'other';
  },
  async phraseState(text, url) {
    if (ERA.P.remoteBook) {
      const r = await ERA.serverCall('POST', '/api/book/status', { phrases: [text], article_url: url });
      return r.phrases[text].state;
    }
    const n = this.normPhrase(text);
    const hits = (await this.phrases()).filter((x) => this.normPhrase(x.text) === n);
    if (!hits.length) return 'none';
    return hits.some((x) => x.article && x.article.url === url) ? 'here' : 'other';
  },

  /** Cancel (like un-starring): drops this article's occurrence; the word disappears when none are left. */
  async cancelWord(lemma, url) {
    lemma = String(lemma || '').toLowerCase();
    const list = await this.words();
    const e = list.find((x) => x.lemma === lemma);
    if (e) {
      e.occurrences = (e.occurrences || []).filter((o) => !(o.article && o.article.url === url));
      await ERA.P.setData('vocab', e.occurrences.length ? list : list.filter((x) => x !== e));
    }
    return this.enqueue('unword', { lemma, article_url: url });
  },
  async cancelPhrase(text, url) {
    const n = this.normPhrase(text);
    await ERA.P.setData('phrases', (await this.phrases()).filter((x) => !(this.normPhrase(x.text) === n && x.article && x.article.url === url)));
    return this.enqueue('unphrase', { text, article_url: url });
  },

  async enqueue(kind, payload) {
    const cfg = await ERA.P.getConfig();
    if (!cfg.server.enabled || !cfg.server.autoSync) return { synced: false, reason: 'server-disabled' };
    let q = (await ERA.P.getData('syncQueue', [])) || [];
    // a cancel makes a still-pending add for the same item pointless
    if (kind === 'unword') q = q.filter((i) => !(i.kind === 'word' && (i.payload.lemma || i.payload.word || '').toLowerCase() === payload.lemma && (!payload.article_url || (i.payload.article || {}).url === payload.article_url)));
    if (kind === 'unphrase') q = q.filter((i) => !(i.kind === 'phrase' && this.normPhrase(i.payload.text) === this.normPhrase(payload.text) && (!payload.article_url || (i.payload.article || {}).url === payload.article_url)));
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
        const ep = item.kind === 'word' || item.kind === 'unword' ? cfg.server.endpoints.words : cfg.server.endpoints.phrases;
        if (item.kind === 'word' || item.kind === 'phrase') await ERA.serverCall('POST', ep, item.payload, cfg);
        else {
          const qs = Object.entries(item.payload).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
          await ERA.serverCall('DELETE', ep + '?' + qs, null, cfg);
        }
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
