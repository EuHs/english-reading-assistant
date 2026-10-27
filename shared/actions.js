/* User actions (toolbar / context menu) and page wiring. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.categoryCache = {};

/** Classify the current article once per page (only when AI is configured). */
ERA.articleCategory = async function (meta, cfg) {
  if (meta.category) return meta.category;
  if (ERA.categoryCache[meta.url] !== undefined) return ERA.categoryCache[meta.url];
  const key = 'cat:' + meta.url;
  const stored = await ERA.P.getData(key, null);
  if (stored) return (ERA.categoryCache[meta.url] = stored);
  if (!ERA.aiConfigured(cfg)) return null;
  try {
    const excerpt = ERA.pageExcerpt ? ERA.pageExcerpt() : ERA.mainText(document).slice(0, 1500);
    const c = await ERA.aiClassify(meta, excerpt);
    ERA.categoryCache[meta.url] = c;
    if (c) await ERA.P.setData(key, c);
    return c;
  } catch (e) { return null; }
};

ERA.Actions = {
  async run(action, opt = {}) {
    const UI = ERA.UI;
    if (!UI.state.text && !UI.captureSelection()) return UI.toast('请先选中文本');
    try {
      switch (action) {
        case 'translate': return await this.translate();
        case 'speak': return await ERA.speak(UI.state.text);
        case 'hl': return await this.annotate('highlight', opt.color || 'yellow');
        case 'ul': return await this.annotate('underline', opt.color || 'blue');
        case 'note': return this.noteEditor();
        case 'vocab': return await this.toggleVocab();
        case 'phrase': return await this.togglePhrase();
        case 'unvocab': return await this.cancelVocab();
        case 'unphrase': return await this.cancelPhrase();
        case 'grammar': return await this.grammar();
      }
    } catch (e) {
      console.error('[ERA]', e);
      UI.toast(e.message || String(e));
    }
  },

  async translate() {
    const UI = ERA.UI, { text, sentence } = UI.state;
    const cfg = await ERA.P.getConfig();
    const hasAI = ERA.aiConfigured(cfg);
    if (ERA.isSingleWord(text)) {
      const d = await ERA.P.lookup(text);
      const card = UI.card('词典', `${UI.dictHtml(d || { word: text })}
        <div class="ai-ctx">${hasAI ? UI.loading('AI 结合语境翻译…') : '<div class="muted">配置 AI 后可获得语境释义、词根与时态分析</div>'}</div>
        <div class="btns"><button class="btn" data-x="analyze" ${hasAI ? '' : 'disabled'}>AI 词根/时态分析</button><button class="btn gh" data-x="vocab">＋生词本</button></div>`);
      this.bindBookButton(card.querySelector('[data-x=vocab]'), 'vocab');
      card.querySelector('[data-x=analyze]').onclick = (e) => this.analyzeInto(card, e.target);
      if (hasAI) {
        ERA.aiTranslate(text, sentence).then((r) => {
          card.querySelector('.ai-ctx').innerHTML = `<div class="sec"><h4>语境释义</h4><div>${UI.esc(r.translation)}</div>${r.sentence_translation ? `<div class="sentence" style="margin-top:4px">${UI.esc(sentence)}</div><div class="muted">${UI.esc(r.sentence_translation)}</div>` : ''}</div>`;
        }).catch((e) => { card.querySelector('.ai-ctx').innerHTML = `<div class="err">${UI.esc(e.message)}</div>`; });
      }
      return;
    }
    const card = UI.card('翻译', `<div class="tr">${UI.esc(text)} ${UI.spk(text)}</div><div class="res">${hasAI ? UI.loading('AI 翻译中…') : '<div class="muted">句子翻译需要 AI：请在设置中配置 AI 接口</div>'}</div>`);
    if (!hasAI) return;
    try {
      const r = await ERA.aiTranslate(text, sentence !== text ? sentence : '');
      card.querySelector('.res').innerHTML = `<div class="sec"><h4>译文</h4><div class="tr">${UI.esc(r.translation)}</div>${r.notes ? `<div class="muted">${UI.esc(r.notes)}</div>` : ''}</div>
        <div class="btns"><button class="btn gh" data-x="phrase">★加入好词好句</button><button class="btn gh" data-x="grammar">语法分析</button></div>`;
      this.bindBookButton(card.querySelector('[data-x=phrase]'), 'phrase', () => this.addPhrase(r));
      card.querySelector('[data-x=grammar]').onclick = () => this.grammar();
    } catch (e) { card.querySelector('.res').innerHTML = `<div class="err">${UI.esc(e.message)}</div>`; }
  },

  async analyzeInto(card, btn) {
    const UI = ERA.UI;
    btn.disabled = true;
    const box = UI.h(`<div>${UI.loading('AI 分析词根、词形与时态…')}</div>`);
    card.querySelector('.bd').appendChild(box);
    try {
      const a = await ERA.aiWord(UI.state.text, UI.state.sentence);
      UI.state.ai = a;
      box.innerHTML = UI.aiWordHtml(a);
    } catch (e) { box.innerHTML = `<div class="err">${UI.esc(e.message)}</div>`; btn.disabled = false; }
  },

  async annotate(type, color) {
    const UI = ERA.UI;
    const ann = await ERA.Annot.add(UI.state.range, type, color);
    window.getSelection().removeAllRanges();
    UI.hideToolbar();
    UI.toast(type === 'highlight' ? '已高亮' : '已添加下划线');
    return ann;
  },

  noteEditor(existing) {
    const UI = ERA.UI;
    const card = UI.card(existing ? '编辑批注' : '添加批注', `
      <div class="sentence">${UI.esc(existing ? existing.text : UI.state.text)}</div>
      <textarea placeholder="写下你的批注…">${UI.esc(existing ? existing.note : '')}</textarea>
      <div class="btns"><button class="btn" data-x="save">保存</button>${existing ? '<button class="btn gh" data-x="del">删除标注</button>' : ''}</div>`);
    const ta = card.querySelector('textarea');
    setTimeout(() => ta.focus(), 50);
    card.querySelector('[data-x=save]').onclick = async () => {
      if (existing) await ERA.Annot.update(existing.id, { note: ta.value, type: existing.type === 'highlight' && ta.value ? 'note' : existing.type });
      else await ERA.Annot.add(UI.state.range, 'note', 'orange', ta.value);
      card.remove(); UI.hideToolbar(); UI.toast('批注已保存');
    };
    const del = card.querySelector('[data-x=del]');
    if (del) del.onclick = async () => { await ERA.Annot.remove(existing.id); card.remove(); UI.toast('已删除'); };
  },

  async markMenu(id) {
    const UI = ERA.UI;
    const ann = (await ERA.Annot.list()).find((x) => x.id === id);
    if (!ann) return;
    const el = document.querySelector(`.era-mark[data-era-id="${id}"]`);
    UI.state = { range: null, text: ann.text, sentence: ann.text };
    if (el) { const r = document.createRange(); r.selectNodeContents(el); UI.state.range = r; }
    if (ann.type === 'vocab' || ann.type === 'phrase') return this.bookMarkMenu(ann);
    const colors = Object.entries(ERA.HIGHLIGHT_COLORS).map(([k, c]) => `<button class="btn gh" data-c="${k}"><span class="dot" style="background:${c}"></span></button>`).join('');
    const card = UI.card({ highlight: '高亮', underline: '下划线', note: '批注' }[ann.type] || '标注', `
      <div class="sentence">${UI.esc(ann.text)} ${UI.spk(ann.text)}</div>
      ${ann.note ? `<div class="sec"><h4>批注</h4><div class="tr">${UI.esc(ann.note)}</div></div>` : ''}
      <div class="btns">${colors}</div>
      <div class="btns"><button class="btn" data-x="note">${ann.note ? '编辑批注' : '添加批注'}</button><button class="btn gh" data-x="tr">翻译</button><button class="btn gh" data-x="del">删除</button></div>`);
    card.querySelectorAll('[data-c]').forEach((b) => (b.onclick = async () => { await ERA.Annot.update(id, { color: b.dataset.c }); card.remove(); }));
    card.querySelector('[data-x=note]').onclick = () => this.noteEditor(ann);
    card.querySelector('[data-x=tr]').onclick = () => this.translate();
    card.querySelector('[data-x=del]').onclick = async () => { await ERA.Annot.remove(id); card.remove(); UI.toast('已删除'); };
  },

  /** Card for a 生词 / 好词好句 mark: look it up again or cancel it. */
  async bookMarkMenu(ann) {
    const UI = ERA.UI;
    const isVocab = ann.type === 'vocab';
    const d = isVocab ? await ERA.P.lookup(ann.ref || ann.text) : null;
    const card = UI.card(isVocab ? '生词本 · 已收藏' : '好词好句 · 已收藏', `
      ${isVocab ? UI.dictHtml(d && d.found ? d : { found: false }) : `<div class="tr"><b>${UI.esc(ann.text)}</b> ${UI.spk(ann.text)}</div>`}
      <div class="btns"><button class="btn ${isVocab ? 'unv' : 'unp'}" data-x="cancel">${isVocab ? '★ 取消生词' : '★ 取消好词好句'}</button>
        <button class="btn gh" data-x="tr">${isVocab ? 'AI 分析' : '翻译'}</button></div>`);
    card.querySelector('[data-x=cancel]').onclick = async () => { card.remove(); await (isVocab ? this.cancelVocab(ann.ref) : this.cancelPhrase(ann.text)); };
    card.querySelector('[data-x=tr]').onclick = () => this.translate();
  },

  /** A card button that behaves like a bookmark star for the current selection. */
  bindBookButton(btn, kind, add) {
    const st = ERA.UI.state;
    const key = kind === 'vocab' ? 'vocabState' : 'phraseState';
    const paint = () => {
      const here = st[key] === 'here';
      btn.textContent = here ? (kind === 'vocab' ? '★ 已在生词本 · 取消' : '★ 已在好词好句 · 取消') : kind === 'vocab' ? '☆ 加入生词本' : '☆ 加入好词好句';
      btn.className = 'btn ' + (here ? (kind === 'vocab' ? 'unv' : 'unp') : 'gh');
    };
    paint();
    if (!st[key]) this.refreshState(null).then(paint);
    btn.onclick = () => (st[key] === 'here' ? (kind === 'vocab' ? this.cancelVocab() : this.cancelPhrase()) : add ? add() : kind === 'vocab' ? this.addVocab() : this.addPhrase());
  },

  articleUrl() {
    return (ERA.pageMetaOverride && ERA.pageMetaOverride.url) || ERA.cleanUrl(location.href);
  },

  /** Resolve the bookmark state of the current selection and paint toolbar buttons / context menu titles. */
  async refreshState(tb) {
    const UI = ERA.UI, st = UI.state, url = this.articleUrl();
    const single = ERA.isSingleWord(st.text);
    try {
      let vocab = 'none';
      if (single) {
        const d = await ERA.P.lookup(st.text);
        st.lemma = ((d && d.lemma) || st.text).toLowerCase();
        vocab = await ERA.Store.wordState(st.lemma, url);
      }
      const phrase = await ERA.Store.phraseState(st.text, url);
      st.vocabState = vocab; st.phraseState = phrase;
      if (tb) { UI.setButtonState(tb.querySelector('[data-a=vocab]'), 'vocab', vocab); UI.setButtonState(tb.querySelector('[data-a=phrase]'), 'phrase', phrase); }
      if (ERA.P.menuState) ERA.P.menuState({ single, vocab, phrase });
    } catch (e) { /* state is cosmetic; adding still works */ }
  },

  repaint() {
    const tb = ERA.UI.wrap && ERA.UI.wrap.querySelector('.tb');
    return this.refreshState(tb);
  },

  async toggleVocab() {
    const st = ERA.UI.state;
    if (!st.vocabState) await this.refreshState(null);
    return st.vocabState === 'here' ? this.cancelVocab() : this.addVocab();
  },
  async togglePhrase() {
    const st = ERA.UI.state;
    if (!st.phraseState) await this.refreshState(null);
    return st.phraseState === 'here' ? this.cancelPhrase() : this.addPhrase();
  },

  async cancelVocab(lemma) {
    const UI = ERA.UI;
    lemma = (lemma || UI.state.lemma || UI.state.text || '').toLowerCase();
    const res = await ERA.Store.cancelWord(lemma, this.articleUrl());
    await ERA.Annot.removeByRef('vocab', lemma);
    UI.toast(`已从生词本取消「${lemma}」` + (res.reason === 'server-disabled' ? '' : res.synced ? ' · 已同步服务器' : ' · 服务器稍后同步'));
    return this.repaint();
  },
  async cancelPhrase(text) {
    const UI = ERA.UI;
    text = text || UI.state.text;
    const res = await ERA.Store.cancelPhrase(text, this.articleUrl());
    await ERA.Annot.removeByRef('phrase', ERA.Store.normPhrase(text));
    UI.toast('已从好词好句取消' + (res.reason === 'server-disabled' ? '' : res.synced ? ' · 已同步服务器' : ' · 服务器稍后同步'));
    return this.repaint();
  },

  /** Mark the saved text on the page (only when the live selection is exactly that text). */
  async markSaved(type, text, ref) {
    const r = ERA.UI.state.range;
    if (!r || r.toString().replace(/\s+/g, ' ').trim() !== text) return;
    try {
      await ERA.Annot.removeByRef(type, ref);
      await ERA.Annot.add(r, type, type === 'vocab' ? '#e11d48' : '#7c3aed', '', { ref });
    } catch (e) { /* page text not anchorable */ }
  },

  /** Right-click "加入生词本": word + translation + sentence + sentence translation + article info. */
  async addVocab() {
    const UI = ERA.UI, { text, sentence } = UI.state;
    const word = text.replace(/[^A-Za-z'’-]/g, '');
    if (!ERA.isSingleWord(word)) return UI.toast('生词本只接受单个单词，词组请用"好词好句"');
    const cfg = await ERA.P.getConfig();
    const hasAI = ERA.aiConfigured(cfg);
    const card = UI.card('加入生词本', UI.loading(hasAI ? '查词典、AI 分析词根与时态、翻译例句…' : '查词典…'));
    const meta = ERA.extractMeta();
    const d = (await ERA.P.lookup(word)) || {};
    const [ai, tr, cat] = await Promise.all([
      UI.state.ai && UI.state.ai.word === word ? UI.state.ai : hasAI && cfg.ui.autoAnalyzeOnAdd ? ERA.aiWord(word, sentence).catch((e) => ({ error: e.message })) : null,
      hasAI && cfg.ui.translateSentenceOnAdd ? ERA.aiTranslate(word, sentence).catch(() => null) : null,
      ERA.articleCategory(meta, cfg),
    ]);
    const a = ai && !ai.error ? ai : {};
    const payload = {
      word, lemma: (a.lemma || d.lemma || word).toLowerCase(), phonetic: a.phonetic || d.phonetic || '', pos: a.pos || '',
      translation: d.translation || (a.definitions || []).join('\n'), meaning: a.meaning || (tr && tr.translation) || '',
      definitions: a.definitions || [], morphology: a.morphology && a.morphology.length ? a.morphology : d.roots || [],
      roots: a.roots && a.roots.length ? a.roots : (d.roots || []).filter((r) => r.type === 'root').map((r) => r.part),
      forms: a.forms || null, tenses: a.tenses || [], etymology: a.etymology || '',
      sentence, sentence_translation: (tr && tr.sentence_translation) || '',
      article: { ...meta, category: cat || undefined }, source: ERA.P.name || 'extension',
    };
    const res = await ERA.Store.addWord(payload);
    UI.state.lemma = payload.lemma;
    await this.markSaved('vocab', text, payload.lemma);
    card.querySelector('.bd').innerHTML = `
      ${UI.dictHtml(d.found ? d : { found: false })}
      ${a.lemma ? UI.aiWordHtml(a) : ai && ai.error ? `<div class="err">AI：${UI.esc(ai.error)}</div>` : ''}
      <div class="sec"><h4>所属语句</h4><div class="sentence">${ERA.highlightWord(sentence, word)}</div><div class="muted">${UI.esc(payload.sentence_translation)}</div></div>
      ${this.metaHtml(payload.article)}
      <div class="sec muted">✅ 已保存到${ERA.P.remoteBook ? '' : '本地'}生词本 · ${res.synced ? '已同步服务器' : res.reason === 'server-disabled' ? '未启用服务器同步' : '服务器同步失败，稍后重试：' + UI.esc(res.error || '')}</div>
      <div class="btns"><button class="btn unv" data-x="undo">★ 取消加入</button></div>`;
    card.querySelector('[data-x=undo]').onclick = async () => { card.remove(); await this.cancelVocab(payload.lemma); };
    window.getSelection().removeAllRanges();
    this.repaint();
  },

  async addPhrase(pre) {
    const UI = ERA.UI, { text, sentence } = UI.state;
    const cfg = await ERA.P.getConfig();
    const hasAI = ERA.aiConfigured(cfg);
    const card = UI.card('加入好词好句', UI.loading(hasAI ? 'AI 翻译中…' : '保存中…'));
    const meta = ERA.extractMeta();
    const isSentence = text.length > 60 || /[.!?]$/.test(text);
    const [tr, cat] = await Promise.all([
      pre && pre.translation ? pre : hasAI ? ERA.aiTranslate(text, isSentence ? '' : sentence).catch((e) => ({ error: e.message })) : null,
      ERA.articleCategory(meta, cfg),
    ]);
    let sentTr = tr && tr.sentence_translation;
    if (isSentence) sentTr = tr && tr.translation;
    const payload = {
      text, translation: (tr && tr.translation) || '', kind: isSentence ? 'sentence' : ERA.isSingleWord(text) ? 'word' : 'phrase',
      sentence: isSentence ? text : sentence, sentence_translation: sentTr || '', note: '',
      article: { ...meta, category: cat || undefined }, source: ERA.P.name || 'extension',
    };
    const res = await ERA.Store.addPhrase(payload);
    await this.markSaved('phrase', text, ERA.Store.normPhrase(text));
    card.querySelector('.bd').innerHTML = `
      <div class="tr"><b>${UI.esc(text)}</b> ${UI.spk(text)}</div>
      <div class="tr">${UI.esc(payload.translation)}${tr && tr.error ? `<span class="err">AI：${UI.esc(tr.error)}</span>` : ''}</div>
      ${!isSentence ? `<div class="sec"><h4>所属语句</h4><div class="sentence">${ERA.highlightWord(sentence, text)}</div><div class="muted">${UI.esc(payload.sentence_translation)}</div></div>` : ''}
      ${this.metaHtml(payload.article)}
      <div class="sec muted">✅ 已保存到好词好句 · ${res.synced ? '已同步服务器' : res.reason === 'server-disabled' ? '未启用服务器同步' : '同步失败，稍后重试：' + UI.esc(res.error || '')}</div>
      <div class="btns"><button class="btn unp" data-x="undo">★ 取消加入</button></div>`;
    card.querySelector('[data-x=undo]').onclick = async () => { card.remove(); await this.cancelPhrase(text); };
    this.repaint();
  },

  metaHtml(a) {
    const esc = ERA.escapeHtml;
    return `<div class="sec"><h4>文章信息</h4><div class="meta">
      <div>题目：${esc(a.title)}</div>
      ${a.author ? `<div>作者：${esc(a.author)}</div>` : ''}
      ${a.published_at ? `<div>出版时间：${esc(a.published_at)}</div>` : ''}
      <div>来源：${esc(a.journal || a.site || '')}${a.category ? ' · 类别：' + esc(a.category) : ''}</div>
      <div>阅读时间：${esc(new Date(a.read_at).toLocaleString())} · 约 ${a.reading_minutes} 分钟读完（${a.word_count} 词）</div></div></div>`;
  },

  async grammar() {
    const UI = ERA.UI;
    let { text, sentence } = UI.state;
    // 划句：a long selection is analysed as-is, a short one expands to its sentence
    const target = text.split(/\s+/).length >= 5 ? text : sentence;
    const cfg = await ERA.P.getConfig();
    if (!ERA.aiConfigured(cfg)) return UI.toast('语法分析需要 AI：请先在设置中配置 AI 接口');
    UI.wrap && UI.wrap.querySelectorAll('.gpanel').forEach((e) => e.remove());
    const card = UI.card('语法分析', `<div class="sentence">${UI.esc(target)}</div>${UI.loading('AI 分析句子成分…')}`, { cls: 'gpanel', fixed: true });
    try {
      const g = await ERA.aiGrammar(target);
      card.querySelector('.bd').innerHTML = UI.grammarHtml(target, g) + `<div class="btns"><button class="btn gh" data-x="phrase">★加入好词好句</button></div>`;
      card.querySelector('[data-x=phrase]').onclick = () => { UI.state = { ...UI.state, text: target, sentence: target }; this.addPhrase({ translation: g.translation }); };
    } catch (e) { card.querySelector('.bd').innerHTML = `<div class="err">${UI.esc(e.message)}</div>`; }
  },
};

ERA.highlightWord = function (sentence, word) {
  const esc = ERA.escapeHtml(sentence || '');
  if (!word) return esc;
  const re = new RegExp('(' + ERA.escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i');
  return esc.replace(re, '<span class="mark">$1</span>');
};

/* ---------- Vocab book panel (used by userscript / viewer) ---------- */
ERA.UI.showBook = async function (tab = 'words') {
  const UI = this;
  const words = await ERA.Store.words();
  const phrases = await ERA.Store.phrases();
  const q = (await ERA.P.getData('syncQueue', [])) || [];
  const list = tab === 'words'
    ? words.map((w) => `<div class="item"><b>${UI.esc(w.word)}</b>${UI.spk(w.word)} <span class="ph">${w.phonetic ? '/' + UI.esc(w.phonetic) + '/' : ''}</span> <button class="x" data-del="${w.id}" style="float:right">×</button>
        <div class="tr">${UI.esc((w.meaning || w.translation || '').slice(0, 120))}</div>
        ${(w.roots || []).length ? `<div class="muted">词根：${w.roots.map(UI.esc).join(', ')}</div>` : ''}
        ${(w.occurrences || []).slice(-2).map((o) => `<div class="sentence">${ERA.highlightWord(o.sentence, o.surface)}</div><div class="meta">— ${UI.esc((o.article || {}).title || '')}</div>`).join('')}</div>`).join('')
    : phrases.map((p) => `<div class="item"><b>${UI.esc(p.text)}</b>${UI.spk(p.text)} <button class="x" data-del="${p.id}" style="float:right">×</button><div class="tr">${UI.esc(p.translation)}</div><div class="meta">— ${UI.esc((p.article || {}).title || '')}</div></div>`).join('');
  const card = UI.card('我的生词本', `
    <div class="btns" style="margin-top:0"><button class="btn ${tab === 'words' ? '' : 'gh'}" data-tab="words">生词 ${words.length}</button><button class="btn ${tab === 'phrases' ? '' : 'gh'}" data-tab="phrases">好词好句 ${phrases.length}</button></div>
    <div class="btns"><button class="btn gh" data-x="sync">同步服务器${q.length ? '（待同步 ' + q.length + '）' : ''}</button><button class="btn gh" data-x="json">导出 JSON</button><button class="btn gh" data-x="csv">导出 CSV</button></div>
    <div style="margin-top:8px">${list || '<div class="muted">暂无内容</div>'}</div>`, { fixed: true, cls: 'gpanel' });
  card.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => UI.showBook(b.dataset.tab)));
  card.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await (tab === 'words' ? ERA.Store.removeWord(b.dataset.del) : ERA.Store.removePhrase(b.dataset.del)); UI.showBook(tab); }));
  card.querySelector('[data-x=sync]').onclick = async () => { const r = await ERA.Store.flush(); UI.toast(r.reason === 'server-disabled' ? '请先在设置中启用服务器' : r.synced ? `同步完成（${r.ok} 条）` : `仍有 ${r.pending} 条未同步：${r.error}`); UI.showBook(tab); };
  card.querySelector('[data-x=json]').onclick = async () => ERA.download('era-book.json', await ERA.Store.exportAll(), 'application/json');
  card.querySelector('[data-x=csv]').onclick = () => ERA.download('era-vocab.csv', ERA.Store.toCSV(words), 'text/csv');
};

ERA.download = function (name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

/* ---------- wiring ---------- */
ERA.init = async function (platform, { restore = true } = {}) {
  ERA.P = platform;
  const UI = ERA.UI;
  const cfg = await platform.getConfig();
  let touchTimer = null;
  const onSelect = async () => {
    const c = await platform.getConfig();
    if (!UI.captureSelection()) return;
    if (c.ui.showToolbar) UI.showToolbar();
    else ERA.Actions.refreshState(null); // keeps context-menu titles in sync
    if (c.ui.autoLookupWord && ERA.isSingleWord(UI.state.text) && !matchMedia('(max-width:640px)').matches) ERA.Actions.translate();
  };
  document.addEventListener('mouseup', (e) => {
    if (UI.host && e.composedPath().includes(UI.host)) return;
    setTimeout(onSelect, 10);
  });
  document.addEventListener('selectionchange', () => {
    if (!('ontouchstart' in window)) return;
    clearTimeout(touchTimer);
    touchTimer = setTimeout(onSelect, 450);
  });
  document.addEventListener('mousedown', (e) => {
    if (UI.host && e.composedPath().includes(UI.host)) return;
    UI.hideToolbar();
    UI.closeCards(true);
    UI.state = { range: null, text: '', sentence: '' };
  });
  document.addEventListener('click', (e) => {
    const m = e.target.closest && e.target.closest('.era-mark');
    if (m && window.getSelection().isCollapsed) ERA.Actions.markMenu(m.dataset.eraId);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { UI.hideToolbar(); UI.closeCards(); } });
  if (restore) {
    const go = () => ERA.Annot.restore(document.body, 0).catch(() => {});
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : setTimeout(go, 300);
  }
  if (cfg.server.enabled) setTimeout(() => ERA.Store.flush().catch(() => {}), 3000);
};

/** Context-menu entry point: the selection is still live when the command arrives. */
ERA.command = function (cmd, selectionText) {
  const UI = ERA.UI;
  UI.mount();
  if (cmd === 'book') return UI.showBook();
  if (cmd === 'settings') return ERA.Settings.openPanel();
  if (!UI.captureSelection()) {
    if (!selectionText) return UI.toast('未检测到选中文本');
    UI.state = { range: null, text: selectionText.trim(), sentence: selectionText.trim() };
  }
  ERA.Actions.run(cmd);
};
