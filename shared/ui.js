/* Floating UI: selection toolbar, dictionary/AI card, grammar panel, notes, vocab book.
 * Everything lives in a Shadow DOM so page CSS can't break it. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.UI_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.wrap{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;
  --bg:#fff;--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--acc:#2563eb;--soft:#f3f4f6}
@media (prefers-color-scheme:dark){.wrap{--bg:#1f2329;--fg:#e5e7eb;--muted:#9ca3af;--line:#374151;--acc:#60a5fa;--soft:#2b3038;color:#e5e7eb}}
.tb{position:absolute;display:flex;gap:2px;padding:4px;background:var(--bg);border:1px solid var(--line);border-radius:10px;
  box-shadow:0 6px 24px rgba(0,0,0,.18);z-index:3;white-space:nowrap;max-width:calc(100vw - 16px);overflow-x:auto}
.tb button{all:unset;cursor:pointer;padding:5px 8px;border-radius:7px;font-size:13px;color:var(--fg);display:flex;align-items:center;gap:3px}
.tb button:hover{background:var(--soft)}
.tb button.st-here[data-a=vocab]{background:#e11d48;color:#fff}
.tb button.st-here[data-a=phrase]{background:#7c3aed;color:#fff}
.tb button.st-other[data-a=vocab]{box-shadow:inset 0 0 0 1.5px #e11d48;color:#e11d48}
.tb button.st-other[data-a=phrase]{box-shadow:inset 0 0 0 1.5px #7c3aed;color:#7c3aed}
.btn.unv{background:#e11d48}.btn.unp{background:#7c3aed}
.tb .sep{width:1px;background:var(--line);margin:3px 2px}
.dot{width:14px;height:14px;border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,.15)}
.card{position:fixed;width:min(420px,calc(100vw - 16px));max-height:min(70vh,560px);display:flex;flex-direction:column;background:var(--bg);
  border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.22);z-index:2;overflow:hidden}
.card.fixed{position:fixed}
.hd{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line);cursor:move;user-select:none;-webkit-user-select:none;touch-action:none;background:var(--soft)}
.hd .t{font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.x{all:unset;cursor:pointer;color:var(--muted);font-size:18px;line-height:1;padding:0 4px}
.bd{padding:12px;overflow:auto;flex:1}
.word{font-size:20px;font-weight:700}
.ph{color:var(--muted);margin-left:6px}
.spk{all:unset;cursor:pointer;margin-left:6px;font-size:16px;vertical-align:middle}
.tr{white-space:pre-wrap;margin:6px 0}
.muted{color:var(--muted);font-size:12px}
.sec{margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)}
.sec h4{margin:0 0 6px;font-size:13px;color:var(--acc)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{padding:2px 8px;border-radius:999px;background:var(--soft);font-size:12px;border:1px solid var(--line)}
.chip.prefix{border-color:#93c5fd}.chip.root{border-color:#f59e0b;font-weight:600}.chip.suffix{border-color:#86efac}
table{border-collapse:collapse;width:100%;font-size:12.5px}
td,th{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600}
.btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.btn{all:unset;cursor:pointer;padding:5px 10px;border-radius:8px;background:var(--acc);color:#fff;font-size:12.5px}
.btn.gh{background:var(--soft);color:var(--fg);border:1px solid var(--line)}
.btn:disabled,.btn[disabled]{opacity:.5;pointer-events:none}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:sp 1s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
.err{color:#dc2626;white-space:pre-wrap}
.legend{display:flex;flex-wrap:wrap;gap:6px 10px;font-size:12px;margin-bottom:10px}
.legend span{display:flex;align-items:center;gap:4px}
.legend i{width:12px;height:12px;border-radius:3px;display:inline-block}
.gs{font-size:16px;line-height:2.3}
.seg{padding:2px 3px;border-radius:4px;border-bottom:3px solid;margin:0 1px;position:relative;cursor:help}
.seg sub{font-size:10px;font-weight:600;margin-left:2px}
.gpanel{position:fixed;right:16px;top:70px;width:min(560px,calc(100vw - 16px));max-height:80vh;resize:both}
textarea{width:100%;min-height:90px;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;background:var(--bg);color:var(--fg)}
input[type=text]{border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit;background:var(--bg);color:var(--fg);width:100%}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:8px;z-index:9;font-size:13px;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.3)}
.item{padding:8px 0;border-bottom:1px solid var(--line)}
.item b{font-size:15px}
.sentence{font-style:italic;color:var(--muted);font-size:12.5px}
.mark{background:#fef08a;color:#111;border-radius:3px;padding:0 2px}
.meta{font-size:12px;color:var(--muted)}
@media (max-width:640px){
  .card{position:fixed!important;left:0!important;right:0!important;bottom:0!important;top:auto!important;width:100vw;max-height:var(--sheet,62vh);border-radius:14px 14px 0 0}
  .gpanel{left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100vw;max-height:var(--sheet,75vh);resize:none}
  .hd{padding-top:14px;position:relative}
  .hd::before{content:'';position:absolute;left:50%;top:5px;width:36px;height:4px;margin-left:-18px;border-radius:2px;background:var(--muted);opacity:.45}
  .tb{position:fixed;left:8px!important;right:8px;top:auto!important;bottom:calc(var(--sheet,62vh) + 10px)}
  .tb.nocard{bottom:16px}
  .tb button{padding:8px 9px;font-size:14px}
}`;

ERA.UI = {
  host: null, root: null, state: { range: null, text: '', sentence: '' },

  mount() {
    if (this.host && this.host.isConnected) return;
    this.host = document.createElement('div');
    this.host.className = 'era-ui';
    this.host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${ERA.UI_CSS}</style><div class="wrap"></div>`;
    this.wrap = this.root.querySelector('.wrap');
    document.documentElement.appendChild(this.host);
    if (!this.resizeHooked) {
      this.resizeHooked = true; // e.g. iPad rotation: bring every card back on screen
      addEventListener('resize', () => this.wrap && this.wrap.querySelectorAll('.card').forEach((c) => { delete c.dataset.dragged; this.keepInView(c); }));
    }
  },

  h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; },
  esc: (s) => ERA.escapeHtml(s),

  toast(msg, ms = 2600) {
    this.mount();
    const el = this.h(`<div class="toast">${this.esc(msg)}</div>`);
    this.wrap.appendChild(el);
    setTimeout(() => el.remove(), ms);
  },

  hideToolbar() { this.wrap && this.wrap.querySelectorAll('.tb').forEach((e) => e.remove()); },
  closeCards(keepGrammar) { this.wrap && this.wrap.querySelectorAll(keepGrammar ? '.card:not(.gpanel)' : '.card').forEach((e) => e.remove()); },

  captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    if (this.host && (this.host.contains(node) || node === this.host)) return false;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 3000) return false;
    this.state = { range: range.cloneRange(), text, sentence: ERA.sentenceFromRange(range) || text };
    return true;
  },

  anchorRect() {
    const r = this.state.range && this.state.range.getBoundingClientRect();
    return r && (r.width || r.height) ? r : { left: 40, right: 240, top: 80, bottom: 100 };
  },

  place(el, rect, offsetY = 8) {
    const vw = document.documentElement.clientWidth;
    el.style.visibility = 'hidden';
    this.wrap.appendChild(el);
    const w = el.offsetWidth;
    const left = Math.max(8, Math.min(rect.left, vw - w - 8)) + window.scrollX;
    let top = rect.bottom + window.scrollY + offsetY;
    const h = el.offsetHeight;
    if (rect.bottom + offsetY + h > window.innerHeight && rect.top - h - offsetY > 0) top = rect.top + window.scrollY - h - offsetY;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.visibility = '';
  },

  showToolbar() {
    this.mount();
    this.hideToolbar();
    const single = ERA.isSingleWord(this.state.text);
    const colors = Object.entries(ERA.HIGHLIGHT_COLORS).slice(0, 4).map(([k, c]) => `<button data-a="hl" data-c="${k}" title="高亮"><span class="dot" style="background:${c}"></span></button>`).join('');
    const tb = this.h(`<div class="tb">
      <button data-a="translate" title="翻译">译</button>
      <button data-a="speak" title="朗读">🔊</button>
      <span class="sep"></span>${colors}
      <button data-a="ul" title="下划线"><u>U</u></button>
      <button data-a="note" title="批注">✎</button>
      <span class="sep"></span>
      ${single ? '<button data-a="vocab" title="加入生词本">☆生词</button>' : ''}
      <button data-a="phrase" title="加入好词好句">☆好句</button>
      <button data-a="grammar" title="语法分析">语法</button>
    </div>`);
    tb.addEventListener('mousedown', (e) => e.preventDefault());
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      ERA.Actions.run(b.dataset.a, { color: b.dataset.c });
    });
    const rect = this.anchorRect();
    this.place(tb, rect, 6);
    ERA.Actions.refreshState(tb);
    return tb;
  },

  /** Bookmark-style button: none → ☆ add · other → ☆+ (saved from another article, adds this one) · here → ★ (click cancels). */
  setButtonState(btn, kind, state) {
    if (!btn) return;
    const name = kind === 'vocab' ? '生词' : '好句';
    const book = kind === 'vocab' ? '生词本' : '好词好句';
    btn.classList.remove('st-none', 'st-other', 'st-here');
    btn.classList.add('st-' + state);
    btn.dataset.state = state;
    btn.textContent = state === 'here' ? '★' + name : state === 'other' ? '☆' + name + '+' : '☆' + name;
    btn.title = state === 'here' ? `已在${book}（本文）· 点击取消` : state === 'other' ? `${book}已收录（来自其他文章）· 点击加入本处` : `加入${book}`;
  },

  /** Drag by the header (mouse, touch or pen). On phones the card is a bottom sheet: dragging changes its height. */
  makeDraggable(card) {
    const hd = card.querySelector('.hd');
    hd.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('button')) return;
      e.preventDefault();
      const phone = matchMedia('(max-width:640px)').matches;
      const r = card.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, h: r.height };
      try { hd.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      const move = (ev) => {
        if (phone) {
          const h = Math.max(innerHeight * 0.2, Math.min(innerHeight * 0.92, start.h - (ev.clientY - start.y)));
          this.wrap.style.setProperty('--sheet', Math.round(h) + 'px');
          return;
        }
        card.dataset.dragged = '1';
        // keep at least part of the header on screen so it can always be dragged back
        card.style.left = Math.max(60 - r.width, Math.min(innerWidth - 60, start.left + ev.clientX - start.x)) + 'px';
        card.style.top = Math.max(0, Math.min(innerHeight - 40, start.top + ev.clientY - start.y)) + 'px';
        card.style.right = card.style.bottom = 'auto';
      };
      const up = () => { hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); };
      hd.addEventListener('pointermove', move);
      hd.addEventListener('pointerup', up);
      hd.addEventListener('pointercancel', up);
    });
  },

  /** Put a floating card next to the selection, fully inside the viewport (it is position:fixed). */
  placeCard(card, rect) {
    card.style.visibility = 'hidden';
    this.wrap.appendChild(card);
    const w = card.offsetWidth, h = card.offsetHeight, gap = 6;
    card.style.left = Math.max(8, Math.min(rect.left, innerWidth - w - 8)) + 'px';
    if (rect.bottom + gap + h <= innerHeight - 8) card.style.top = rect.bottom + gap + 'px';
    // above the selection: anchor the bottom edge so a taller card grows upward, away from the text
    else if (rect.top - gap - h >= 8) { card.style.top = 'auto'; card.style.bottom = innerHeight - rect.top + gap + 'px'; }
    else card.style.top = Math.max(8, innerHeight - h - 8) + 'px';
    card.style.visibility = '';
    // AI results arrive later and make the card taller: keep its bottom on screen unless the user moved it
    if (window.ResizeObserver) new ResizeObserver(() => this.keepInView(card)).observe(card);
  },

  keepInView(card) {
    if (!card.isConnected || card.dataset.dragged || matchMedia('(max-width:640px)').matches) return;
    const r = card.getBoundingClientRect();
    if (r.top < 8 || r.bottom > innerHeight - 8) { card.style.bottom = 'auto'; card.style.top = Math.max(8, Math.min(r.top, innerHeight - r.height - 8)) + 'px'; }
    if (r.right > innerWidth - 8) card.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
  },

  card(title, bodyHtml, { cls = '', fixed = false } = {}) {
    this.mount();
    this.closeCards(true);
    const card = this.h(`<div class="card ${cls} ${fixed ? 'fixed' : ''}"><div class="hd"><span class="t">${this.esc(title)}</span><button class="x" title="关闭">×</button></div><div class="bd">${bodyHtml}</div></div>`);
    card.querySelector('.x').addEventListener('click', () => { card.remove(); this.hideToolbar(); });
    card.addEventListener('mousedown', (e) => e.stopPropagation());
    if (fixed) this.wrap.appendChild(card);
    else {
      const tb = this.wrap.querySelector('.tb');
      this.placeCard(card, tb ? tb.getBoundingClientRect() : this.anchorRect());
    }
    const tb = this.wrap.querySelector('.tb');
    if (tb) tb.classList.remove('nocard');
    this.makeDraggable(card);
    card.addEventListener('click', (e) => {
      const sp = e.target.closest('[data-speak]');
      if (sp) ERA.speak(sp.dataset.speak).catch((err) => this.toast(err.message));
    });
    return card;
  },

  loading(msg) { return `<div><span class="spin"></span>${this.esc(msg || '加载中…')}</div>`; },
  spk(text) { return `<button class="spk" data-speak="${this.esc(text)}" title="朗读">🔊</button>`; },

  /* ---------- renderers ---------- */
  dictHtml(d) {
    if (!d || !d.found) return d && d.error ? `<div class="err">${this.esc(d.error)}</div>` : `<div class="muted">离线词典未收录该词</div>`;
    const ex = d.exchange || {};
    const forms = Object.entries(ERA.EXCHANGE_LABELS).filter(([k]) => k !== '0' && ex[k]).map(([k, l]) => `<span class="chip">${l}: ${this.esc(ex[k])}</span>`).join('');
    return `
      <div><span class="word">${this.esc(d.word)}</span><span class="ph">${d.phonetic ? '/' + this.esc(d.phonetic) + '/' : ''}</span>${this.spk(d.word)}</div>
      ${d.formOf ? `<div class="muted">${this.esc(d.formOf)}</div>` : ''}
      <div class="tr">${this.esc(d.translation)}</div>
      ${d.lemmaTranslation ? `<div class="muted">原形 <b>${this.esc(d.lemma)}</b>${this.spk(d.lemma)}：${this.esc(d.lemmaTranslation)}</div>` : ''}
      ${forms ? `<div class="sec"><h4>词形变化</h4><div class="chips">${forms}</div></div>` : ''}
      ${d.roots && d.roots.length ? `<div class="sec"><h4>词根词缀（离线词根表）</h4>${this.morphHtml(d.roots)}</div>` : ''}`;
  },

  morphHtml(parts) {
    const label = { prefix: '前缀', root: '词根', suffix: '后缀' };
    return `<div class="chips">${parts.map((p) => `<span class="chip ${p.type}" title="${this.esc(p.origin || '')}">${label[p.type] || p.type} <b>${this.esc(p.part)}</b> ${this.esc(String(p.meaning || '').split(/[;；]/)[0].slice(0, 48))}${p.origin ? ' · ' + this.esc(p.origin) : ''}</span>`).join('')}</div>`;
  },

  aiWordHtml(a) {
    const formLabel = { base: '原形', third_person: '第三人称单数', past: '过去式', past_participle: '过去分词', present_participle: '现在分词', plural: '复数', comparative: '比较级', superlative: '最高级' };
    const forms = Object.entries(a.forms || {}).filter(([, v]) => v).map(([k, v]) => `<tr><th>${formLabel[k] || k}</th><td>${this.esc(v)} ${this.spk(v)}</td></tr>`).join('');
    const tenses = (a.tenses || []).map((t) => `<tr><td>${this.esc(t.name)}</td><td><b>${this.esc(t.form)}</b></td><td>${this.esc(t.example)} ${this.spk(t.example)}</td></tr>`).join('');
    return `
      <div class="sec"><h4>AI 语境释义</h4>
        <div><b>${this.esc(a.lemma || a.word)}</b> <span class="ph">${a.phonetic ? '/' + this.esc(a.phonetic) + '/' : ''}</span> <span class="muted">${this.esc(a.pos || '')}</span></div>
        <div class="tr">${this.esc(a.meaning || '')}</div>
        ${(a.definitions || []).length ? `<div class="muted">${a.definitions.map((x) => this.esc(x)).join('<br>')}</div>` : ''}
      </div>
      ${(a.morphology || []).length ? `<div class="sec"><h4>构词（词根可能不止一个）</h4>${this.morphHtml(a.morphology)}${a.etymology ? `<div class="muted" style="margin-top:6px">${this.esc(a.etymology)}</div>` : ''}</div>` : ''}
      ${forms ? `<div class="sec"><h4>词形</h4><table>${forms}</table></div>` : ''}
      ${tenses ? `<div class="sec"><h4>不同时态</h4><table><tr><th>时态</th><th>形式</th><th>例句</th></tr>${tenses}</table></div>` : ''}
      ${(a.collocations || []).length ? `<div class="sec"><h4>搭配</h4><div class="chips">${a.collocations.map((c) => `<span class="chip">${this.esc(c)}</span>`).join('')}</div></div>` : ''}`;
  },

  grammarHtml(sentence, g) {
    const R = ERA.GRAMMAR_ROLES;
    const legend = Object.entries(R).map(([k, v]) => `<span><i style="background:${v.color}"></i>${v.label}</span>`).join('');
    const segs = ERA.alignSegments(sentence, g.segments || []);
    const body = segs.map((s) => {
      if (!s.role) return this.esc(s.text);
      const r = R[s.role] || R.other;
      return `<span class="seg" style="background:${r.color}22;border-color:${r.color}" title="${this.esc(r.label + (s.note ? '：' + s.note : ''))}">${this.esc(s.text)}<sub style="color:${r.color}">${r.label}</sub></span>`;
    }).join('');
    const clauses = (g.clauses || []).map((c) => `<tr><td>${this.esc(c.type)}</td><td>${this.esc(c.text)}</td><td>${this.esc(c.function || '')}</td></tr>`).join('');
    const notes = (g.segments || []).filter((s) => s.note).map((s) => { const r = R[s.role] || R.other; return `<tr><td style="color:${r.color};white-space:nowrap">${r.label}</td><td>${this.esc(s.text)}</td><td>${this.esc(s.note)}</td></tr>`; }).join('');
    return `
      <div class="legend">${legend}</div>
      <div class="gs">${body} ${this.spk(sentence)}</div>
      <div class="sec"><h4>翻译</h4><div>${this.esc(g.translation || '')}</div></div>
      <div class="sec"><h4>句型</h4><div>${this.esc(g.sentence_type || '')}</div>${g.skeleton ? `<div class="muted">主干：${this.esc(g.skeleton)}</div>` : ''}</div>
      ${notes ? `<div class="sec"><h4>成分说明</h4><table>${notes}</table></div>` : ''}
      ${clauses ? `<div class="sec"><h4>从句</h4><table><tr><th>类型</th><th>原文</th><th>作用</th></tr>${clauses}</table></div>` : ''}
      ${g.explanation ? `<div class="sec"><h4>讲解</h4><div class="tr">${this.esc(g.explanation)}</div></div>` : ''}`;
  },
};

/** Map AI segments back onto the original sentence so nothing is lost or reworded. */
ERA.alignSegments = function (sentence, segs) {
  const out = [];
  let pos = 0;
  const lower = sentence.toLowerCase();
  for (const s of segs) {
    const t = String(s.text || '').trim();
    if (!t) continue;
    const i = lower.indexOf(t.toLowerCase(), pos);
    if (i < 0) continue;
    if (i > pos) out.push({ text: sentence.slice(pos, i) });
    out.push({ text: sentence.slice(i, i + t.length), role: s.role, note: s.note });
    pos = i + t.length;
  }
  if (pos < sentence.length) out.push({ text: sentence.slice(pos) });
  return out;
};
