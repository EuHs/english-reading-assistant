/* Web app: vocab / phrases / roots / articles / quiz / wrong book / stats / reader / settings. */
(function () {
  const $app = document.getElementById('app');
  const esc = ERA.escapeHtml;
  const api = (method, path, body) => ERA.serverCall(method, path, body);
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  const spk = (t) => `<button class="spk" data-speak="${esc(t)}" title="朗读">🔊</button>`;
  const CATS = ERA.CATEGORIES;
  const TYPE_LABEL = { en2zh: '英译中', zh2en: '中译英', cloze: '例句填空' };
  const ROOT_LABEL = { prefix: '前缀', root: '词根', suffix: '后缀' };
  const state = { words: { q: '', category: '', root: '', sort: 'new', page: 1 }, phrases: { q: '', category: '', kind: '' } };

  ERA.P = WebP;

  /* ---------- helpers ---------- */
  function toast(msg) { ERA.UI.toast(msg); }
  function modal(html) {
    const m = document.getElementById('modal');
    m.querySelector('.modal-body').innerHTML = html;
    m.hidden = false;
    return m.querySelector('.modal-body');
  }
  document.querySelector('.modal-x').onclick = () => (document.getElementById('modal').hidden = true);
  document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.hidden = true; });
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-speak]');
    if (s && !s.closest('.era-ui')) { e.stopPropagation(); ERA.speak(s.dataset.speak).catch((err) => toast(err.message)); }
  }, true);
  const catChips = (cur, counts, attr = 'data-cat') => `<div class="chips"><span class="chip ${!cur ? 'on' : ''}" ${attr}="">全部</span>${CATS.map((c) => `<span class="chip ${cur === c ? 'on' : ''}" ${attr}="${c}">${c}${counts && counts[c] != null ? `<small>${counts[c]}</small>` : ''}</span>`).join('')}</div>`;
  const morph = (parts) => `<div class="chips">${(parts || []).map((p) => `<span class="chip ${p.type}" data-root="${esc(p.root || p.part)}" title="${esc(p.origin || '')}">${ROOT_LABEL[p.type] || ''} <b>${esc(p.root || p.part)}</b> ${esc(p.meaning || '')}</span>`).join('')}</div>`;
  const artLine = (o) => o && o.title ? `<div class="muted">— ${esc(o.title)}${o.author ? ' · ' + esc(o.author) : ''}${o.published_at ? ' · ' + esc(o.published_at) : ''}${o.category ? ` <span class="tag">${esc(o.category)}</span>` : ''}</div>` : '';
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let catCounts = null;
  async function loadCatCounts() {
    try { const cs = await api('GET', '/api/categories'); catCounts = Object.fromEntries(cs.map((c) => [c.name, c.words])); } catch (e) { catCounts = null; }
    return catCounts;
  }

  /* ---------- auth: the web app signs in with the admin account; the API token is only for extensions ---------- */
  let me = null; // { user, mustChange }
  const authApi = async (method, path, body) => {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + WebP.token() }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '服务器错误 ' + r.status);
    return d;
  };
  // a handler that returned false for other keys would cancel them, and nothing could be typed
  const onEnter = (fn) => $app.querySelectorAll('input').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') fn(); }));
  async function ensureAuth() {
    me = WebP.token() ? await authApi('GET', '/api/auth/me').catch(() => null) : null;
    if (me && !me.mustChange) return true;
    if (me) showPasswordForm(); else showLogin();
    return false;
  }
  function showLogin() {
    $app.innerHTML = `<div class="login card"><h2>🔐 登录</h2>
      <div class="row"><label>账号</label><input type="text" id="user" autocomplete="username"></div>
      <div class="row"><label>密码</label><input type="password" id="pass" autocomplete="current-password"></div>
      <div class="bar" style="margin-top:12px"><button class="btn" id="go">登录</button><span class="muted" id="msg"></span></div></div>`;
    const go = async () => {
      const pass = document.getElementById('pass').value;
      try {
        const r = await authApi('POST', '/api/auth/login', { username: document.getElementById('user').value.trim(), password: pass });
        WebP.setToken(r.token);
        if (r.mustChange) { me = r; showPasswordForm(pass); } else route();
      } catch (e) { document.getElementById('msg').textContent = e.message; }
    };
    document.getElementById('go').onclick = go;
    onEnter(go);
    document.getElementById('user').focus();
  }
  /** Account form: forced after signing in with the default password, and in settings. `current` skips re-typing it right after login. */
  function passwordFields(current) {
    return `<div class="row"><label>账号</label><input type="text" id="nuser" value="${esc(me.user)}" autocomplete="username"></div>
      ${current ? '' : '<div class="row"><label>当前密码</label><input type="password" id="cur" autocomplete="current-password"></div>'}
      <div class="row"><label>新密码</label><input type="password" id="np1" autocomplete="new-password" placeholder="至少 6 位"></div>
      <div class="row"><label>确认新密码</label><input type="password" id="np2" autocomplete="new-password"></div>`;
  }
  async function savePassword(current) {
    const v = (id) => document.getElementById(id).value;
    if (v('np1') !== v('np2')) throw new Error('两次输入的新密码不一致');
    const r = await authApi('POST', '/api/auth/password', { username: v('nuser').trim(), current: current || v('cur'), password: v('np1') });
    me = { user: r.user, mustChange: false };
  }
  function showPasswordForm(current) {
    $app.innerHTML = `<div class="login card"><h2>🔑 修改默认密码</h2>
      <p class="muted">首次登录请设置新密码，以后用新密码登录；账号名也可以一起改。</p>${passwordFields(current)}
      <div class="bar" style="margin-top:12px"><button class="btn" id="chg">保存并进入</button><button class="btn gh" id="out">退出登录</button><span class="muted" id="msg"></span></div></div>`;
    const chg = async () => {
      try { await savePassword(current); toast('密码已修改'); route(); } catch (e) { document.getElementById('msg').textContent = e.message; }
    };
    document.getElementById('chg').onclick = chg;
    onEnter(chg);
    document.getElementById('out').onclick = logout;
  }
  async function logout() {
    await authApi('POST', '/api/auth/logout').catch(() => {});
    localStorage.removeItem('era_token');
    location.reload();
  }
  function copyText(text) { // navigator.clipboard needs HTTPS, and the server usually runs on plain http://IP:8080
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
    return Promise.resolve();
  }

  /* ---------- words ---------- */
  async function pageWords() {
    const s = state.words;
    const [res, roots] = await Promise.all([api('GET', '/api/words?' + qs({ ...s, size: 30 })), api('GET', '/api/roots'), catCounts || loadCatCounts()]);
    $app.innerHTML = `<h2>📒 生词本 <span class="muted">${res.total} 个</span></h2>
      <div class="bar"><input type="search" id="q" placeholder="搜索单词 / 释义 / 变形" value="${esc(s.q)}" style="flex:1;min-width:200px">
        <select id="root"><option value="">全部词根</option>${roots.map((r) => `<option value="${esc(r.root)}" ${s.root === r.root ? 'selected' : ''}>${esc(r.root)} ${esc(r.meaning || '')} (${r.words})</option>`).join('')}</select>
        <select id="sort">${Object.entries({ new: '最新加入', alpha: '字母顺序', wrong: '错误最多', freq: '出现最多' }).map(([k, v]) => `<option value="${k}" ${s.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      ${catChips(s.category, catCounts)}
      <div class="grid" style="margin-top:12px">${res.items.map(wordCard).join('') || '<div class="empty">还没有生词。在扩展或油猴脚本中右键「加入生词本」，或使用阅读器页面。</div>'}</div>
      ${pager(res)}`;
    document.getElementById('q').oninput = debounce((e) => { s.q = e.target.value.trim(); s.page = 1; pageWords(); });
    document.getElementById('root').onchange = (e) => { s.root = e.target.value; s.page = 1; pageWords(); };
    document.getElementById('sort').onchange = (e) => { s.sort = e.target.value; pageWords(); };
    bindCommon(() => pageWords(), s);
    const q = document.getElementById('q');
    if (s.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
  function pager(res) {
    const pages = Math.ceil(res.total / res.size);
    if (pages <= 1) return '';
    return `<div class="pager"><button class="btn gh sm" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}>上一页</button><span class="muted">${res.page} / ${pages}</span><button class="btn gh sm" data-page="${res.page + 1}" ${res.page >= pages ? 'disabled' : ''}>下一页</button></div>`;
  }
  function wordCard(w) {
    const o = w.occurrences[0];
    return `<div class="card click" data-word="${w.id}">
      <div class="w-head"><span class="w-lemma">${esc(w.lemma)}</span>${spk(w.lemma)}<span class="ph">${w.phonetic ? '/' + esc(w.phonetic) + '/' : ''}</span>
        ${w.wrong_count ? `<span class="tag bad">错 ${w.wrong_count}</span>` : ''}</div>
      <div>${esc(w.meaning || (w.translation || '').split('\n')[0])}</div>
      ${w.forms_seen.length > 1 || (w.forms_seen[0] && w.forms_seen[0] !== w.lemma) ? `<div class="muted">见过的形式：${w.forms_seen.map(esc).join(', ')}</div>` : ''}
      ${w.roots.length ? `<div style="margin-top:6px">${morph(w.roots)}</div>` : ''}
      ${o ? `<div class="sentence">${ERA.highlightWord(o.sentence, o.surface)}</div>${artLine(o)}` : ''}
      <div style="margin-top:6px">${w.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}<span class="muted">${w.occ > 1 ? ` 出现于 ${w.occ} 处` : ''}</span></div></div>`;
  }
  function bindCommon(reload, s) {
    $app.querySelectorAll('[data-cat]').forEach((c) => (c.onclick = () => { s.category = c.dataset.cat; s.page = 1; reload(); }));
    $app.querySelectorAll('[data-page]').forEach((b) => (b.onclick = () => { s.page = +b.dataset.page; reload(); scrollTo(0, 0); }));
    $app.querySelectorAll('[data-word]').forEach((c) => (c.onclick = (e) => { if (e.target.closest('[data-root]')) return; showWord(c.dataset.word); }));
    $app.querySelectorAll('.card [data-root]').forEach((c) => (c.onclick = (e) => { e.stopPropagation(); state.words = { ...state.words, root: c.dataset.root, page: 1, category: '' }; location.hash = '#/words'; pageWords(); }));
  }

  async function showWord(id) {
    const w = await api('GET', '/api/words/' + id);
    const FL = { base: '原形', third_person: '第三人称单数', past: '过去式', past_participle: '过去分词', present_participle: '现在分词', plural: '复数', comparative: '比较级', superlative: '最高级' };
    const forms = Object.entries(w.forms || {}).filter(([, v]) => v).map(([k, v]) => `<tr><th>${FL[k] || k}</th><td>${esc(v)} ${spk(v)}</td></tr>`).join('');
    const tenses = (w.tenses || []).map((t) => `<tr><td>${esc(t.name)}</td><td><b>${esc(t.form)}</b></td><td>${esc(t.example)} ${spk(t.example)}</td></tr>`).join('');
    const body = modal(`
      <div class="w-head"><span class="w-lemma" style="font-size:28px">${esc(w.lemma)}</span>${spk(w.lemma)}<span class="ph">${w.phonetic ? '/' + esc(w.phonetic) + '/' : ''} ${esc(w.pos || '')}</span></div>
      <div style="font-size:16px;margin:6px 0">${esc(w.meaning || '')}</div>
      <div class="muted" style="white-space:pre-wrap">${esc(w.translation || '')}</div>
      ${w.morphology.length || w.roots.length ? `<div class="sec"><h4>构词 · 词根</h4>${morph(w.morphology.length ? w.morphology : w.roots)}${w.etymology ? `<div class="muted" style="margin-top:6px">${esc(w.etymology)}</div>` : ''}</div>` : ''}
      ${forms ? `<div class="sec"><h4>词形变化</h4><table>${forms}</table></div>` : ''}
      ${tenses ? `<div class="sec"><h4>不同时态</h4><table><tr><th>时态</th><th>形式</th><th>例句</th></tr>${tenses}</table></div>` : ''}
      <div class="sec"><h4>出处（${w.occurrences.length}）</h4>${w.occurrences.map((o) => `<div style="margin-bottom:10px"><div class="sentence">${ERA.highlightWord(o.sentence, o.surface)} ${spk(o.sentence || '')}</div><div class="muted">${esc(o.sentence_translation || '')}</div>${artLine(o)}${o.url && /^https?:/.test(o.url) ? `<a class="muted" href="${esc(o.url)}" target="_blank" rel="noopener">打开原文 ↗</a>` : ''}</div>`).join('')}</div>
      <div class="sec muted">测验 ${w.quiz.total || 0} 次 · 正确 ${w.quiz.correct || 0} · 错题计数 ${w.wrong_count || 0} · ${w.enriched ? 'AI 已分析' : 'AI 未分析'}</div>
      <div class="bar" style="margin-top:12px"><button class="btn gh" id="enrich">🤖 AI 重新分析词根/时态</button><button class="btn gh" id="edit">编辑释义</button><button class="btn danger" id="del">删除</button></div>`);
    body.querySelector('#enrich').onclick = async (e) => { e.target.disabled = true; e.target.textContent = '分析中…'; try { await api('POST', `/api/words/${id}/enrich`); showWord(id); } catch (err) { toast(err.message); e.target.disabled = false; } };
    body.querySelector('#edit').onclick = async () => { const m = prompt('中文释义', w.meaning || ''); if (m != null) { await api('PATCH', '/api/words/' + id, { meaning: m }); showWord(id); } };
    body.querySelector('#del').onclick = async () => { if (!confirm(`删除「${w.lemma}」及其全部出处？`)) return; await api('DELETE', '/api/words/' + id); document.getElementById('modal').hidden = true; route(); };
  }

  /* ---------- phrases ---------- */
  async function pagePhrases() {
    const s = state.phrases;
    const res = await api('GET', '/api/phrases?' + qs({ ...s, size: 100 }));
    $app.innerHTML = `<h2>⭐ 好词好句 <span class="muted">${res.total} 条</span></h2>
      <div class="bar"><input type="search" id="q" placeholder="搜索" value="${esc(s.q)}" style="flex:1;min-width:200px">
      <select id="kind"><option value="">全部类型</option><option value="word" ${s.kind === 'word' ? 'selected' : ''}>好词</option><option value="phrase" ${s.kind === 'phrase' ? 'selected' : ''}>词组</option><option value="sentence" ${s.kind === 'sentence' ? 'selected' : ''}>好句</option></select></div>
      ${catChips(s.category)}
      <div class="grid" style="margin-top:12px">${res.items.map((p) => `<div class="card">
        <div style="font-size:${p.kind === 'sentence' ? 16 : 19}px;font-weight:${p.kind === 'sentence' ? 500 : 700}">${esc(p.text)} ${spk(p.text)}</div>
        <div>${esc(p.translation)}</div>
        ${p.occurrences.map((o) => `${p.kind !== 'sentence' ? `<div class="sentence">${ERA.highlightWord(o.sentence, p.text)}</div><div class="muted">${esc(o.sentence_translation || '')}</div>` : ''}${artLine(o)}`).join('')}
        <div style="text-align:right"><button class="btn gh sm" data-pdel="${p.id}">删除</button></div></div>`).join('') || '<div class="empty">暂无好词好句</div>'}</div>`;
    document.getElementById('q').oninput = debounce((e) => { s.q = e.target.value.trim(); pagePhrases(); });
    document.getElementById('kind').onchange = (e) => { s.kind = e.target.value; pagePhrases(); };
    bindCommon(pagePhrases, s);
    $app.querySelectorAll('[data-pdel]').forEach((b) => (b.onclick = async () => { if (confirm('删除这条？')) { await api('DELETE', '/api/phrases/' + b.dataset.pdel); pagePhrases(); } }));
  }

  /* ---------- roots ---------- */
  async function pageRoots() {
    const roots = await api('GET', '/api/roots');
    const draw = (q, type) => roots.filter((r) => (!type || r.type === type) && (!q || r.root.includes(q) || (r.meaning || '').includes(q)))
      .map((r) => `<div class="card click" data-r="${esc(r.root)}"><div class="w-head"><span class="w-lemma">${esc(r.root)}</span><span class="tag">${ROOT_LABEL[r.type] || r.type}</span><span class="muted">${esc(r.origin || '')}</span></div>
        <div>${esc(r.meaning || '')}</div><div class="muted">${r.words} 个生词${r.wrong ? ` · 错 ${r.wrong} 次` : ''}</div></div>`).join('') || '<div class="empty">暂无词根数据</div>';
    $app.innerHTML = `<h2>🌱 词根分类 <span class="muted">${roots.length} 个</span></h2>
      <div class="bar"><input type="search" id="q" placeholder="搜索词根 / 含义" style="flex:1"><select id="type"><option value="">全部</option><option value="prefix">前缀</option><option value="root">词根</option><option value="suffix">后缀</option></select></div>
      <div class="grid" id="list">${draw()}</div>`;
    const re = () => { document.getElementById('list').innerHTML = draw(document.getElementById('q').value.trim(), document.getElementById('type').value); bind(); };
    const bind = () => $app.querySelectorAll('[data-r]').forEach((c) => (c.onclick = () => { state.words = { q: '', category: '', root: c.dataset.r, sort: 'new', page: 1 }; location.hash = '#/words'; }));
    document.getElementById('q').oninput = debounce(re, 200);
    document.getElementById('type').onchange = re;
    bind();
  }

  /* ---------- articles ---------- */
  async function pageArticles() {
    const arts = await api('GET', '/api/articles');
    $app.innerHTML = `<h2>📰 文章 <span class="muted">${arts.length} 篇</span></h2><div class="card" style="overflow-x:auto"><table>
      <tr><th>题目</th><th class="hide-m">作者</th><th class="hide-m">出版</th><th>类别</th><th>生词</th><th class="hide-m">好句</th><th class="hide-m">阅读</th></tr>
      ${arts.map((a) => `<tr><td>${/^https?:/.test(a.url) ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title || a.url)}</a>` : esc(a.title || a.url)}<div class="muted">${esc(a.site || '')}${a.doi ? ' · DOI ' + esc(a.doi) : ''}</div></td>
        <td class="hide-m">${esc(a.author || '')}</td><td class="hide-m">${esc(a.published_at || '')}</td>
        <td><select data-art="${a.id}"><option value="">未分类</option>${CATS.map((c) => `<option ${a.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
        <td><a href="#/words" data-aw="${a.id}">${a.words}</a></td><td class="hide-m">${a.phrases}</td>
        <td class="hide-m muted">${esc((a.last_read_at || '').slice(0, 10))}<br>约 ${a.reading_minutes || '?'} 分钟</td></tr>`).join('')}</table></div>`;
    $app.querySelectorAll('[data-art]').forEach((s) => (s.onchange = async () => { await api('PATCH', '/api/articles/' + s.dataset.art, { category: s.value }); catCounts = null; toast('已更新类别'); }));
    $app.querySelectorAll('[data-aw]').forEach((a) => (a.onclick = async (e) => {
      e.preventDefault();
      const res = await api('GET', '/api/words?article=' + a.dataset.aw + '&size=200');
      const b = modal(`<h3>本文生词（${res.total}）</h3><div class="grid">${res.items.map(wordCard).join('')}</div>`);
      b.querySelectorAll('[data-word]').forEach((c) => (c.onclick = () => showWord(c.dataset.word)));
    }));
  }

  /* ---------- quiz ---------- */
  const quizCfg = { size: 20, category: '', root: '', mode: 'all' };
  async function pageQuiz() {
    const roots = await api('GET', '/api/roots');
    await (catCounts || loadCatCounts());
    $app.innerHTML = `<div class="quiz"><h2>📝 生词测验</h2>
      <div class="card"><h4>题量</h4><div class="sizes">${[20, 50, 80, 100].map((n) => `<span class="chip ${quizCfg.size === n ? 'on' : ''}" data-size="${n}">${n} 题</span>`).join('')}</div>
      <h4>范围</h4><div class="chips"><span class="chip ${quizCfg.mode === 'all' ? 'on' : ''}" data-mode="all">全部生词</span><span class="chip ${quizCfg.mode === 'wrong' ? 'on' : ''}" data-mode="wrong">仅错题集</span></div>
      <h4>类别</h4>${catChips(quizCfg.category, catCounts)}
      <h4>词根</h4><select id="root"><option value="">不限</option>${roots.map((r) => `<option value="${esc(r.root)}" ${quizCfg.root === r.root ? 'selected' : ''}>${esc(r.root)} ${esc(r.meaning || '')} (${r.words})</option>`).join('')}</select>
      <p class="muted">题型随机：英译中 / 中译英 / 例句填空，每题 4 个选项（1 个正确 + 3 个干扰项）。键盘 1-4 选择，回车下一题。</p>
      <button class="btn" id="start">开始测验</button> <span class="muted" id="msg"></span></div>
      <h3 style="margin-top:20px">历史记录</h3><div class="card" id="hist">加载中…</div></div>`;
    $app.querySelectorAll('[data-size]').forEach((c) => (c.onclick = () => { quizCfg.size = +c.dataset.size; pageQuiz(); }));
    $app.querySelectorAll('[data-mode]').forEach((c) => (c.onclick = () => { quizCfg.mode = c.dataset.mode; pageQuiz(); }));
    $app.querySelectorAll('[data-cat]').forEach((c) => (c.onclick = () => { quizCfg.category = c.dataset.cat; pageQuiz(); }));
    document.getElementById('root').onchange = (e) => (quizCfg.root = e.target.value);
    document.getElementById('start').onclick = async () => {
      try { runQuiz(await api('POST', '/api/quiz', quizCfg)); } catch (e) { document.getElementById('msg').textContent = e.message; }
    };
    const hist = await api('GET', '/api/quiz');
    document.getElementById('hist').innerHTML = hist.length ? `<table><tr><th>时间</th><th>范围</th><th>成绩</th><th></th></tr>${hist.slice(0, 20).map((q) => `<tr><td>${esc(q.created_at)}</td><td>${q.mode === 'wrong' ? '错题集' : '全部'}${q.category ? ' · ' + esc(q.category) : ''}${q.root ? ' · ' + esc(q.root) : ''}</td><td>${q.correct}/${q.total}</td><td>${q.finished_at ? `<a href="#" data-review="${q.id}">查看</a>` : `<a href="#" data-resume="${q.id}">继续</a>`}</td></tr>`).join('')}</table>` : '<div class="muted">还没有测验记录</div>';
    $app.querySelectorAll('[data-review]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); showResult(await api('POST', `/api/quiz/${a.dataset.review}/finish`)); }));
    $app.querySelectorAll('[data-resume]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); runQuiz(await api('GET', '/api/quiz/' + a.dataset.resume)); }));
  }

  function runQuiz(quiz) {
    let i = quiz.questions.findIndex((q) => q.chosen == null);
    if (i < 0) return finish();
    let answered = false;
    function draw() {
      const q = quiz.questions[i];
      answered = false;
      const long = q.prompt.length > 40;
      $app.innerHTML = `<div class="quiz"><div class="bar" style="justify-content:space-between"><span class="muted">第 ${i + 1} / ${quiz.questions.length} 题</span><span class="muted">正确 ${quiz.questions.filter((x) => x.correct).length}</span><button class="btn gh sm" id="quit">结束测验</button></div>
        <div class="progress"><i style="width:${(i / quiz.questions.length) * 100}%"></i></div>
        <div class="card"><div class="q-type">${TYPE_LABEL[q.type]}</div>
        <div class="q-prompt ${long ? 'long' : ''}">${esc(q.prompt)} ${q.type !== 'zh2en' ? spk(q.prompt.replace('_____', '…')) : ''}</div>
        ${q.hint ? `<div class="muted">${esc(q.hint)}</div>` : ''}
        <div class="opts">${q.options.map((o, k) => `<button class="opt" data-k="${k}"><b>${k + 1}</b>${esc(o)}</button>`).join('')}</div>
        <div id="fb"></div></div></div>`;
      $app.querySelectorAll('.opt').forEach((b) => (b.onclick = () => choose(+b.dataset.k)));
      document.getElementById('quit').onclick = () => { if (confirm('结束本次测验？未答的题目计为未完成。')) finish(); };
      if (q.type === 'en2zh') ERA.speak(q.prompt).catch(() => {});
    }
    async function choose(k) {
      if (answered) return;
      answered = true;
      const q = quiz.questions[i];
      $app.querySelectorAll('.opt').forEach((b) => (b.disabled = true));
      const r = await api('POST', `/api/quiz/${quiz.id}/answer`, { question_id: q.id, choice: k });
      q.chosen = k; q.correct = r.correct; q.answer = r.answer;
      $app.querySelector(`.opt[data-k="${r.answer}"]`).classList.add('right');
      if (!r.correct) $app.querySelector(`.opt[data-k="${k}"]`).classList.add('wrong');
      const w = r.word || {};
      const o = (w.occurrences || [])[0];
      document.getElementById('fb').innerHTML = `<div class="feedback">${r.correct ? '✅ 正确' : '❌ 错误'} · <b>${esc(w.lemma)}</b> ${spk(w.lemma || '')} <span class="ph">${w.phonetic ? '/' + esc(w.phonetic) + '/' : ''}</span> ${esc(w.meaning || '')}
        ${(w.roots || []).length ? `<div style="margin-top:6px">${morph(w.roots)}</div>` : ''}
        ${o ? `<div class="sentence">${ERA.highlightWord(o.sentence, o.surface)}</div>` : ''}</div>
        <div style="margin-top:12px;text-align:right"><button class="btn" id="next">${i + 1 < quiz.questions.length ? '下一题 ⏎' : '查看结果'}</button></div>`;
      document.getElementById('next').onclick = next;
      if (r.correct) setTimeout(() => { if (quiz.questions[i] === q) next(); }, 900);
    }
    function next() { if (!answered) return; i++; if (i >= quiz.questions.length) finish(); else draw(); }
    async function finish() { document.onkeydown = null; showResult(await api('POST', `/api/quiz/${quiz.id}/finish`)); }
    document.onkeydown = (e) => {
      if (/^[1-4]$/.test(e.key)) choose(+e.key - 1);
      if (e.key === 'Enter') next();
    };
    draw();
  }

  /** Result page: score + wrong-question review + re-test of this quiz's mistakes. */
  function showResult(quiz) {
    document.onkeydown = null;
    const total = quiz.questions.length, right = quiz.questions.filter((q) => q.correct).length;
    $app.innerHTML = `<div class="quiz"><h2>测验结果</h2><div class="card"><div class="score">${right} / ${total}</div><div style="text-align:center" class="muted">正确率 ${pct(total ? right / total : 0)}${quiz.category ? ' · ' + esc(quiz.category) : ''}</div>
      <div class="bar" style="justify-content:center;margin-top:12px">${quiz.wrong.length ? '<button class="btn" id="review">📖 复习错题</button><button class="btn gh" id="retest">🔁 错题再测</button>' : ''}<a class="btn gh" href="#/wrong">错题集</a><button class="btn gh" id="again">再来一次</button></div></div>
      <h3>错题（${quiz.wrong.length}）</h3>${quiz.wrong.map((q) => `<div class="card" style="margin-bottom:10px"><div class="muted">${TYPE_LABEL[q.type]} · ${esc(q.prompt)}</div>
        <div>你的答案：<span style="color:var(--bad)">${q.chosen == null ? '未作答' : esc(q.options[q.chosen])}</span> · 正确：<b style="color:var(--ok)">${esc(q.options[q.answer])}</b></div>
        <div class="w-head" style="margin-top:6px"><b>${esc(q.detail.lemma)}</b>${spk(q.detail.lemma)}<span class="ph">${q.detail.phonetic ? '/' + esc(q.detail.phonetic) + '/' : ''}</span> ${esc(q.detail.meaning || '')}</div>
        ${q.detail.roots.length ? morph(q.detail.roots) : ''}</div>`).join('') || '<div class="empty">全部正确 🎉</div>'}</div>`;
    document.getElementById('again').onclick = () => pageQuiz();
    if (quiz.wrong.length) {
      document.getElementById('review').onclick = () => reviewCards(quiz.wrong.map((q) => q.detail), () => showResult(quiz));
      document.getElementById('retest').onclick = () => localRetest(quiz.wrong, () => showResult(quiz));
    }
  }

  function reviewCards(words, done) {
    let i = 0;
    const draw = () => {
      const w = words[i];
      const o = w.occurrences[0];
      $app.innerHTML = `<div class="quiz"><div class="bar" style="justify-content:space-between"><span class="muted">复习 ${i + 1} / ${words.length}</span><button class="btn gh sm" id="back">返回结果</button></div>
        <div class="card flash"><div class="w-head"><span class="w-lemma" style="font-size:32px">${esc(w.lemma)}</span>${spk(w.lemma)}<span class="ph">${w.phonetic ? '/' + esc(w.phonetic) + '/' : ''}</span></div>
        <div style="font-size:17px;margin:8px 0">${esc(w.meaning || '')}</div><div class="muted" style="white-space:pre-wrap">${esc((w.translation || '').slice(0, 200))}</div>
        ${w.morphology.length || w.roots.length ? `<div class="sec">${morph(w.morphology.length ? w.morphology : w.roots)}</div>` : ''}
        ${o ? `<div class="sec"><div class="sentence">${ERA.highlightWord(o.sentence, o.surface)} ${spk(o.sentence)}</div><div class="muted">${esc(o.sentence_translation || '')}</div>${artLine(o)}</div>` : ''}</div>
        <div class="bar" style="justify-content:space-between;margin-top:12px"><button class="btn gh" id="prev" ${i === 0 ? 'disabled' : ''}>上一个</button><button class="btn" id="nx">${i + 1 < words.length ? '下一个' : '完成'}</button></div></div>`;
      document.getElementById('back').onclick = done;
      document.getElementById('prev').onclick = () => { i--; draw(); };
      document.getElementById('nx').onclick = () => { if (++i >= words.length) done(); else draw(); };
      ERA.speak(w.lemma).catch(() => {});
    };
    draw();
  }

  function localRetest(wrong, done) {
    const qs2 = wrong.map((q) => { const opts = q.options.map((t, k) => ({ t, ok: k === q.answer })).sort(() => Math.random() - 0.5); return { ...q, opts }; });
    let i = 0, right = 0;
    const draw = () => {
      if (i >= qs2.length) {
        $app.innerHTML = `<div class="quiz"><div class="card"><div class="score">${right} / ${qs2.length}</div><p style="text-align:center" class="muted">错题再测完成（不计入统计）</p><div class="bar" style="justify-content:center"><button class="btn" id="b">返回结果</button></div></div></div>`;
        return (document.getElementById('b').onclick = done);
      }
      const q = qs2[i];
      $app.innerHTML = `<div class="quiz"><div class="muted">错题再测 ${i + 1} / ${qs2.length}</div><div class="card"><div class="q-type">${TYPE_LABEL[q.type]}</div><div class="q-prompt ${q.prompt.length > 40 ? 'long' : ''}">${esc(q.prompt)}</div>${q.hint ? `<div class="muted">${esc(q.hint)}</div>` : ''}
        <div class="opts">${q.opts.map((o, k) => `<button class="opt" data-k="${k}"><b>${k + 1}</b>${esc(o.t)}</button>`).join('')}</div></div></div>`;
      $app.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
        const k = +b.dataset.k;
        $app.querySelectorAll('.opt').forEach((x, j) => { x.disabled = true; if (q.opts[j].ok) x.classList.add('right'); });
        if (q.opts[k].ok) right++; else b.classList.add('wrong');
        setTimeout(() => { i++; draw(); }, q.opts[k].ok ? 600 : 1500);
      }));
    };
    draw();
  }

  /* ---------- wrong book ---------- */
  async function pageWrong(cat = '', all = false) {
    const list = await api('GET', '/api/wrongbook?' + qs({ category: cat, all: all ? 1 : '' }));
    $app.innerHTML = `<h2>❌ 错题集 <span class="muted">${list.length} 个</span></h2>
      <div class="bar"><label><input type="checkbox" id="all" ${all ? 'checked' : ''}> 包含已掌握</label>
      <span style="flex:1"></span>${[20, 50, 80, 100].map((n) => `<button class="btn gh sm" data-wq="${n}">错题测验 ${n}</button>`).join('')}</div>
      ${catChips(cat)}
      <div class="card" style="margin-top:12px;overflow-x:auto"><table><tr><th>单词</th><th>释义</th><th>错误</th><th class="hide-m">作答</th><th class="hide-m">正确率</th><th class="hide-m">最近出错</th><th></th></tr>
      ${list.map((w) => `<tr><td><a href="#" data-word="${w.id}"><b>${esc(w.lemma)}</b></a> ${spk(w.lemma)}</td><td>${esc((w.meaning || w.translation || '').split('\n')[0].slice(0, 50))}</td>
        <td><span class="tag bad">${w.wrong_count}</span></td><td class="hide-m">${w.attempts}</td><td class="hide-m">${pct(w.attempts ? w.rights / w.attempts : null)}</td><td class="hide-m muted">${esc((w.last_wrong_at || '').slice(0, 16))}</td>
        <td>${w.mastered ? `<button class="btn gh sm" data-m="${w.id}" data-v="0">取消掌握</button>` : `<button class="btn gh sm" data-m="${w.id}" data-v="1">已掌握</button>`}</td></tr>`).join('')}</table>
      ${list.length ? '' : '<div class="empty">错题集为空</div>'}</div><p class="muted">在测验中连续答对 3 次的单词会自动标记为已掌握。</p>`;
    document.getElementById('all').onchange = (e) => pageWrong(cat, e.target.checked);
    $app.querySelectorAll('[data-cat]').forEach((c) => (c.onclick = () => pageWrong(c.dataset.cat, all)));
    $app.querySelectorAll('[data-word]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showWord(a.dataset.word); }));
    $app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = async () => { await api('POST', '/api/wrongbook/' + b.dataset.m, { mastered: b.dataset.v === '1' }); pageWrong(cat, all); }));
    $app.querySelectorAll('[data-wq]').forEach((b) => (b.onclick = async () => {
      try { runQuiz(await api('POST', '/api/quiz', { size: +b.dataset.wq, mode: 'wrong', category: cat })); } catch (e) { toast(e.message); }
    }));
  }

  /* ---------- stats ---------- */
  async function pageStats() {
    const s = await api('GET', '/api/stats');
    const t = s.totals;
    const maxW = Math.max(1, ...s.byCategory.map((c) => c.words));
    const maxD = Math.max(1, ...s.daily.map((d) => d.answers));
    $app.innerHTML = `<h2>📊 统计</h2>
      <div class="stats">${[['生词', t.words], ['好词好句', t.phrases], ['文章', t.articles], ['词根', t.roots], ['测验', t.quizzes], ['作答', t.answers], ['总正确率', pct(t.accuracy)], ['待复习错词', t.wrongWords], ['已掌握', t.mastered]].map(([k, v]) => `<div class="stat"><b>${v}</b><span class="muted">${k}</span></div>`).join('')}</div>
      <div class="card"><h3 style="margin-top:0">按类别</h3><div style="overflow-x:auto"><table><tr><th>类别</th><th>生词</th><th></th><th>作答</th><th>错误</th><th>正确率</th><th>待复习</th></tr>
        ${s.byCategory.map((c) => `<tr><td>${c.category}</td><td>${c.words}</td><td><div class="barv"><i style="width:${(c.words / maxW) * 100}%"></i></div></td><td>${c.answers}</td><td>${c.wrong}</td><td>${pct(c.accuracy)}</td><td>${c.wrongWords}</td></tr>`).join('')}</table></div></div>
      <div class="grid" style="margin-top:12px">
        <div class="card"><h3 style="margin-top:0">按词 · 错误最多</h3><table><tr><th>单词</th><th>错</th><th>作答</th><th>正确率</th></tr>
          ${s.byWord.slice(0, 20).map((w) => `<tr><td><a href="#" data-word="${w.id}">${esc(w.lemma)}</a> ${w.mastered ? '<span class="tag">已掌握</span>' : ''}<div class="muted">${esc(w.meaning)}</div></td><td>${w.wrong_count}</td><td>${w.attempts}</td><td>${pct(w.accuracy)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">暂无</td></tr>'}</table></div>
        <div class="card"><h3 style="margin-top:0">按题型</h3><table><tr><th>题型</th><th>作答</th><th>正确率</th></tr>${s.byType.map((x) => `<tr><td>${TYPE_LABEL[x.type] || x.type}</td><td>${x.answers}</td><td>${pct(x.answers ? x.correct / x.answers : null)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">暂无</td></tr>'}</table>
          <h3>按词根 · 错误</h3><table><tr><th>词根</th><th>生词</th><th>错</th></tr>${s.byRoot.slice(0, 12).map((r) => `<tr><td><b>${esc(r.root)}</b> <span class="muted">${esc(r.meaning || '')}</span></td><td>${r.words}</td><td>${r.wrong}</td></tr>`).join('')}</table></div>
        <div class="card"><h3 style="margin-top:0">近 30 天作答</h3>${s.daily.length ? `<div style="display:flex;align-items:flex-end;gap:3px;height:140px">${s.daily.map((d) => `<div title="${d.day}: ${d.correct}/${d.answers}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%"><div style="background:var(--bad);height:${((d.answers - d.correct) / maxD) * 100}%"></div><div style="background:var(--ok);height:${(d.correct / maxD) * 100}%"></div></div>`).join('')}</div><div class="muted">绿色正确 · 红色错误</div>` : '<div class="muted">暂无</div>'}
          <h3>最近测验</h3><table>${s.recent.map((q) => `<tr><td class="muted">${esc(q.created_at.slice(5, 16))}</td><td>${q.correct}/${q.total}</td><td>${q.category ? esc(q.category) : ''}</td></tr>`).join('')}</table></div>
      </div>`;
    $app.querySelectorAll('[data-word]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showWord(a.dataset.word); }));
  }

  /* ---------- reader: selection translation + grammar analysis with the shared toolbar ---------- */
  async function pageReader() {
    $app.innerHTML = `<h2>📖 阅读器</h2>
      <div class="card"><div class="bar"><input type="url" id="url" placeholder="粘贴文章或 PDF 链接（服务器抓取）" style="flex:1;min-width:220px"><button class="btn" id="fetch">打开</button>
        <label class="btn gh">本地 PDF<input type="file" id="pdf" accept="application/pdf" hidden></label><button class="btn gh" id="paste">粘贴文本</button></div>
        <div class="muted">选中文字后弹出工具条：翻译 / 朗读(Kokoro) / 高亮 / 下划线 / 批注 / 加入生词本 / 好词好句 / 语法分析</div></div>
      <div id="rd" style="margin-top:12px"></div>`;
    const rd = document.getElementById('rd');
    document.getElementById('fetch').onclick = async () => {
      const url = document.getElementById('url').value.trim();
      if (!url) return;
      rd.innerHTML = '<div class="empty">抓取中…</div>';
      try {
        const r = await fetch('/api/fetch?url=' + encodeURIComponent(url), { headers: { Authorization: 'Bearer ' + WebP.token() } });
        if (!r.ok) throw new Error((await r.json()).error);
        const type = r.headers.get('content-type') || '';
        if (/pdf/.test(type) || /\.pdf($|\?)/i.test(url)) return openPdf(await r.arrayBuffer(), { url, name: url.split('/').pop() });
        const html = new TextDecoder(/charset=([\w-]+)/i.exec(type)?.[1] || 'utf-8').decode(await r.arrayBuffer());
        renderHtml(html, r.headers.get('x-final-url') || url);
      } catch (e) { rd.innerHTML = `<div class="empty">打开失败：${esc(e.message)}</div>`; }
    };
    document.getElementById('pdf').onchange = async (e) => { const f = e.target.files[0]; if (f) openPdf(await f.arrayBuffer(), { name: f.name }); };
    document.getElementById('paste').onclick = () => {
      rd.innerHTML = `<div class="card"><div class="bar"><input type="text" id="t" placeholder="文章题目" style="flex:2"><input type="text" id="a" placeholder="作者" style="flex:1"><input type="text" id="d" placeholder="出版时间" style="flex:1"><input type="text" id="s" placeholder="来源/期刊" style="flex:1"></div>
        <textarea id="txt" rows="10" placeholder="粘贴英文文章"></textarea><div class="bar"><button class="btn" id="show">开始阅读</button></div></div>`;
      document.getElementById('show').onclick = () => {
        const v = (id) => document.getElementById(id).value.trim();
        const text = v('txt');
        const words = (text.match(/[A-Za-z]+/g) || []).length;
        const title = v('t') || text.slice(0, 60);
        setMeta({ url: 'text:' + title, title, author: v('a'), published_at: v('d'), site: v('s') || '粘贴文本', word_count: words, reading_minutes: Math.max(1, Math.round(words / 220)) });
        rd.innerHTML = `<article class="reader-wrap"><h1>${esc(title)}</h1><div class="muted">${esc([v('a'), v('d'), v('s')].filter(Boolean).join(' · '))}</div>${text.split(/\n\s*\n|\n/).filter((p) => p.trim()).map((p) => `<p>${esc(p)}</p>`).join('')}</article>`;
        ERA.Annot.restore(rd, 0);
      };
    };
    function setMeta(m) {
      ERA.pageMetaOverride = { description: '', keywords: '', journal: '', doi: '', ...m };
      ERA.annotKey = m.url;
      ERA.pageExcerpt = () => (rd.innerText || '').slice(0, 1500);
    }
    async function openPdf(buf, info) {
      rd.innerHTML = '<div class="pdfbox" id="pdfbox"></div>';
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
      try { await ERA.PdfReader.open(document.getElementById('pdfbox'), buf, info); } catch (e) { rd.innerHTML = `<div class="empty">PDF 打开失败：${esc(e.message)}</div>`; }
    }
    function renderHtml(html, url) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      ERA.pageMetaOverride = null;
      const meta = ERA.extractMeta(doc);
      setMeta({ ...meta, url: ERA.cleanUrl(url), site: meta.site === location.hostname ? new URL(url).hostname : meta.site });
      const root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
      const blocks = Array.from(root.querySelectorAll('h2,h3,p,li,blockquote')).map((el) => [el.tagName.toLowerCase(), el.textContent.replace(/\s+/g, ' ').trim()]).filter(([, t]) => t.length > 1 && (t.length > 30 || /[a-z]/i.test(t)));
      const m = ERA.pageMetaOverride;
      rd.innerHTML = `<article class="reader-wrap"><h1>${esc(m.title)}</h1><div class="muted">${esc([m.author, m.published_at, m.site].filter(Boolean).join(' · '))} · 约 ${m.reading_minutes} 分钟 · <a href="${esc(url)}" target="_blank" rel="noopener">原文 ↗</a></div>
        ${blocks.map(([tag, t]) => `<${tag === 'li' ? 'p' : tag}>${tag === 'li' ? '• ' : ''}${esc(t)}</${tag === 'li' ? 'p' : tag}>`).join('') || '<p class="muted">未能提取正文</p>'}</article>`;
      ERA.Annot.restore(rd, 0);
    }
  }

  /* ---------- settings ---------- */
  async function pageSettings() {
    const s = await api('GET', '/api/settings');
    const voices = await api('GET', '/api/tts/voices');
    let { token } = await api('GET', '/api/settings/api-token');
    const kv = WebP.ls.get('kokoroVoice', '') || voices.default;
    $app.innerHTML = `<h2>⚙️ 设置</h2>
      <div class="card"><h3 style="margin-top:0">扩展 / 油猴脚本连接</h3>
        <div class="muted">在扩展或油猴脚本的“设置 → 服务器”里填这两项（网页端用下面的管理员账号登录，不用 Token）。</div>
        <div class="row"><label>服务器地址</label><input type="text" id="origin" value="${esc(location.origin)}" readonly><button class="btn gh" id="copyorigin">复制</button></div>
        <div class="row"><label>API Token</label><input type="password" id="apitok" value="${esc(token)}" autocomplete="off" spellcheck="false"><button class="btn gh" id="showtok">显示</button><button class="btn gh" id="copytok">复制</button></div>
        <div class="bar"><button class="btn" id="savetok">保存 Token</button><button class="btn gh" id="regen">随机生成</button><span class="muted">可以自己输入（至少 12 位：字母、数字或 . _ ~ + / = -），也可以随机生成；保存后旧 Token 立即失效。</span></div>
        <div class="bar"><button class="btn gh" id="extcfg">生成扩展 / 油猴脚本配置文件</button><span class="muted">导入到扩展或油猴脚本的“设置 → 导入”，自动填好服务器地址与 Token，并使用服务器 AI。</span></div>
        <div class="muted" id="m2"></div></div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">服务器 AI（上游）</h3>
        <div class="row"><label>类型</label><select id="atype"><option value="openai">直连 OpenAI 兼容接口（OpenAI / DeepSeek / 智谱 / 通义 / Ollama …）</option>
          <option value="relay" ${s.ai_type === 'relay' ? 'selected' : ''}>经过跳板（one-api / new-api / LiteLLM / 自建转发）</option></select></div>
        <div class="row"><label>上游 Base URL</label><input type="text" id="base" value="${esc(s.ai_base_url)}" placeholder="https://api.z.ai/api/coding/paas/v4"></div>
        <div class="row"><label>上游 API Key</label><input type="password" id="key" value="${esc(s.ai_api_key)}" placeholder="留空不修改"></div>
        <div id="relaybox">
          <div class="muted">OpenAI 兼容模式：请求发到跳板的 /chat/completions，由跳板连上游（上游地址可留空，有跳板密钥时用它代替 API Key）；转发模式：请求 POST 到跳板，真实上游地址放在下面的请求头里，跳板密钥放在 X-Relay-Key。</div>
          <div class="row"><label>跳板地址</label><input type="text" id="rurl" value="${esc(s.ai_relay_url)}" placeholder="http://127.0.0.1:3000/v1"></div>
          <div class="row"><label>跳板模式</label><select id="rmode"><option value="openai">OpenAI 兼容：跳板自身提供 /chat/completions</option>
            <option value="forward" ${s.ai_relay_mode === 'forward' ? 'selected' : ''}>转发：POST 到跳板，上游地址放在请求头</option></select></div>
          <div class="row"><label>上游地址请求头</label><input type="text" id="rhdr" value="${esc(s.ai_relay_target_header)}" placeholder="X-Target-URL"></div>
          <div class="row"><label>跳板密钥</label><input type="password" id="rkey" value="${esc(s.ai_relay_key)}" placeholder="可空；留空不修改"></div>
        </div>
        <div class="row"><label>附加请求头 JSON</label><input type="text" id="hdrs" value="${esc(s.ai_headers)}" placeholder='可空，如 {"X-Channel":"zhipu"}'></div>
        <div class="row"><label>模型</label><input type="text" id="model" value="${esc(s.ai_model)}" list="models"><datalist id="models"></datalist><button class="btn gh" id="pull">从上游拉取模型</button></div>
        <div class="muted">下面的参数留空 = 不发送，用模型默认；服务器会按供应商的写法发送，模型报错时自动调整后重试。</div>
        <div class="row"><label>温度 / top_p</label><input type="text" id="temp" value="${esc(s.ai_temperature)}" placeholder="默认"><input type="text" id="topp" value="${esc(s.ai_top_p)}" placeholder="默认"></div>
        <div class="row"><label>最大输出 tokens</label><input type="text" id="maxtok" value="${esc(s.ai_max_tokens)}" placeholder="默认"></div>
        <div class="row"><label>思考强度</label><input type="text" id="effort" value="${esc(s.ai_reasoning)}" list="efforts" placeholder="默认（不发送）"><datalist id="efforts"></datalist>
          <select id="rfmt">${Object.entries(ERA.REASONING_FORMATS).map(([k, l]) => `<option value="${k}" ${(s.ai_reasoning_format || 'auto') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="row"><label>自定义参数 JSON</label><input type="text" id="extra" value="${esc(s.ai_extra)}" placeholder='合并进每次请求，可覆盖上面各项，如 {"top_k":40}'></div>
        <div class="muted" id="minfo"></div>
        <div class="bar"><button class="btn" id="save">保存</button><button class="btn gh" id="test">测试</button><span class="muted" id="m1"></span></div></div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">配置导入 / 导出</h3>
        <div class="bar"><button class="btn gh" id="exp1">导出服务器 AI 配置（含密钥）</button><button class="btn gh" id="exp0">导出（不含密钥）</button><label class="btn gh">导入<input type="file" id="imp" accept=".json" hidden></label></div>
        <div class="bar"><a class="btn gh" id="backup" href="#">备份全部数据 (JSON)</a></div></div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">从本服务器安装油猴脚本</h3>
        <div class="muted">jsDelivr 打不开时用这里的地址安装（与 GitHub 上的同一版本）。</div>
        <div class="bar"><a class="btn gh" href="/userscript/english-reading-assistant.ios.user.js">iPhone / iPad（Safari + Userscripts）</a><a class="btn gh" href="/userscript/english-reading-assistant.user.js">Tampermonkey / Violentmonkey</a></div></div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">阅读器</h3>
        <div class="row"><label>AI 功能</label><select id="aimode"><option value="auto">自动：查词、翻译、加入时自动调用 AI</option><option value="manual" ${WebP.ls.get('ui', {}).aiMode === 'manual' ? 'selected' : ''}>手动：点卡片上的 AI 按钮才调用</option></select></div></div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Kokoro 离线朗读</h3>
        <div class="muted">状态：${voices.status.ready ? '✅ 已加载' : voices.status.loading ? '⏳ 加载中' : voices.status.enabled ? '首次朗读时加载模型' : '未启用'}${voices.status.error ? ' · 错误：' + esc(voices.status.error) : ''}</div>
        <div class="row"><label>音色</label><select id="voice">${voices.voices.map(([v, n]) => `<option value="${v}" ${kv === v ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="btn gh" id="try">试听</button></div>
        <div class="row"><label>语速</label><input type="text" id="rate" value="${WebP.ls.get('tts', {}).rate || 1}" style="max-width:80px"></div></div>
      <div class="card" style="margin-top:12px"><h3 style="margin-top:0">管理员账号</h3>
        <div class="muted">网页端用这个账号登录。改密码后，其他浏览器需要重新登录。</div>${passwordFields()}
        <div class="bar"><button class="btn" id="chg">修改账号 / 密码</button><button class="btn gh" id="logout">退出登录</button><span class="muted" id="m3"></span></div></div>`;
    const v = (id) => document.getElementById(id).value.trim();
    const m1 = (t) => (document.getElementById('m1').textContent = t);
    // parameter information the provider gave per model on the last pull (OpenRouter-style /models)
    const models = {};
    try { const mi = s.ai_model_info && JSON.parse(s.ai_model_info); if (mi && mi.id) models[mi.id] = mi; } catch (e) { /* ignore */ }
    const showInfo = () => {
      const meta = models[v('model')] || null;
      const efforts = meta && meta.efforts ? [...(meta.mandatory ? [] : ['off']), ...meta.efforts] : ['off', ...ERA.EFFORTS.slice(1)];
      document.getElementById('efforts').innerHTML = efforts.map((e) => `<option value="${esc(e)}">${e === 'off' ? '关闭思考' : ''}</option>`).join('');
      let t = meta ? ERA.describeModel(meta) : '「从上游拉取模型」后，供应商若提供这个模型的参数信息（如 OpenRouter）会显示在这里；多数供应商只给模型名。不确定时点「测试」，模型报错会自动调整参数。';
      if (meta && meta.mandatory && /^(off|none)$/i.test(v('effort'))) t = '⚠ 这个模型不能关闭思考，会自动改用最低一档。' + t;
      let keys = [];
      try { keys = Object.keys(ERA.parseExtra(v('extra'))).filter((k) => ERA.REASONING_KEYS.includes(k)); } catch (e) { /* shown on save */ }
      if (keys.length) t = `⚠ 自定义参数 JSON 里的 ${keys.join('、')} 会覆盖「思考强度」。` + t;
      document.getElementById('minfo').textContent = t;
    };
    showInfo();
    document.getElementById('model').addEventListener('input', showInfo);
    document.getElementById('effort').addEventListener('input', showInfo);
    document.getElementById('extra').addEventListener('input', showInfo);
    // after 测试: put what the provider required into the form, so 保存 keeps it
    const FIELD = { temperature: 'temp', top_p: 'topp', max_tokens: 'maxtok', reasoning_effort: 'effort', thinking: 'effort', reasoning: 'effort', enable_thinking: 'effort', thinking_budget: 'effort' };
    const applyNotes = (notes) => {
      for (const { fix } of notes) {
        (fix.drop || []).forEach((k) => FIELD[k] && (document.getElementById(FIELD[k]).value = ''));
        if (fix.effort) document.getElementById('effort').value = fix.effort;
      }
      showInfo();
    };
    const showType = () => (document.getElementById('relaybox').hidden = v('atype') !== 'relay');
    showType();
    document.getElementById('atype').onchange = showType;
    const body = () => ({
      ai_type: v('atype'), ai_base_url: v('base'), ai_api_key: v('key'), ai_relay_url: v('rurl'), ai_relay_mode: v('rmode'), ai_relay_target_header: v('rhdr') || 'X-Target-URL',
      ai_relay_key: v('rkey'), ai_headers: v('hdrs'), ai_model: v('model'), ai_extra: v('extra'), ai_temperature: v('temp'), ai_top_p: v('topp'),
      ai_max_tokens: v('maxtok'), ai_reasoning: v('effort'), ai_reasoning_format: v('rfmt'), ai_model_info: models[v('model')] ? JSON.stringify(models[v('model')]) : '',
    });
    document.getElementById('save').onclick = async () => { try { await api('PUT', '/api/settings', body()); m1('已保存 ✓'); } catch (e) { m1('✗ ' + e.message); } };
    document.getElementById('pull').onclick = async () => { m1('拉取中…'); try { await api('PUT', '/api/settings', body()); const r = await api('GET', '/api/ai/models'); Object.assign(models, r.info || {}); document.getElementById('models').innerHTML = r.models.map((x) => `<option value="${esc(x)}">`).join(''); showInfo(); const n = Object.keys(r.info || {}).length; m1(`共 ${r.models.length} 个${n ? `（${n} 个带参数信息）` : '（供应商没有提供参数信息）'}：${r.models.slice(0, 8).join(', ')}${r.models.length > 8 ? '…' : ''}`); } catch (e) { m1('✗ ' + e.message); } };
    document.getElementById('test').onclick = async () => { m1('测试中…'); const t0 = Date.now(); try { await api('PUT', '/api/settings', body()); const r = await api('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Reply with: OK' }], fresh: true }); const notes = r.notes || []; if (notes.length) applyNotes(notes); m1(`✓ ${r.content.slice(0, 30)} (${Date.now() - t0}ms)` + (notes.length ? ` · 已按模型要求调整：${notes.map((x) => x.text).join('；')}。上面的参数已改好，点「保存」生效` : '')); } catch (e) { m1('✗ ' + e.message); } };
    const dl = async (secrets) => ERA.download(secrets ? 'era-server-config.json' : 'era-server-config-public.json', JSON.stringify(await api('GET', '/api/settings/export?secrets=' + (secrets ? 1 : 0)), null, 2), 'application/json');
    document.getElementById('exp1').onclick = () => dl(true);
    document.getElementById('exp0').onclick = () => dl(false);
    document.getElementById('imp').onchange = async (e) => { try { await api('POST', '/api/settings/import', JSON.parse(await e.target.files[0].text())); toast('已导入'); pageSettings(); } catch (err) { toast(err.message); } };
    document.getElementById('extcfg').onclick = () => {
      const c = ERA.defaultConfig();
      c.server = { ...c.server, enabled: true, baseUrl: location.origin, apiToken: token };
      c.ai.profiles.push({ ...c.ai.profiles[0], id: 'server', name: '服务器 AI', type: 'server', model: '' });
      c.ai.active = 'server';
      ERA.download('era-config.json', ERA.exportConfig(c), 'application/json');
    };
    document.getElementById('backup').onclick = async (e) => { e.preventDefault(); ERA.download('era-backup.json', JSON.stringify(await api('GET', '/api/export')), 'application/json'); };
    document.getElementById('aimode').onchange = (e) => { WebP.ls.set('ui', { ...WebP.ls.get('ui', {}), aiMode: e.target.value }); toast('已保存'); };
    document.getElementById('voice').onchange = (e) => WebP.ls.set('kokoroVoice', e.target.value);
    document.getElementById('rate').onchange = (e) => WebP.ls.set('tts', { ...WebP.ls.get('tts', {}), rate: +e.target.value || 1 });
    document.getElementById('try').onclick = () => { WebP.ls.set('kokoroVoice', v('voice')); ERA.speak('Reading widely is the best way to build vocabulary.').catch((e) => toast(e.message)); };
    const m2 = (t) => (document.getElementById('m2').textContent = t);
    const tokInput = document.getElementById('apitok');
    document.getElementById('copyorigin').onclick = () => copyText(location.origin).then(() => toast('已复制服务器地址'));
    document.getElementById('showtok').onclick = (e) => { const show = tokInput.type === 'password'; tokInput.type = show ? 'text' : 'password'; e.target.textContent = show ? '隐藏' : '显示'; };
    document.getElementById('copytok').onclick = () => copyText(tokInput.value.trim()).then(() => toast('已复制 API Token'));
    const setToken = async (method, body, done) => {
      if (!confirm('旧 Token 会立即失效，已连接的扩展和油猴脚本要换成新 Token（或重新导入配置文件）。继续？')) return;
      try { token = (await api(method, '/api/settings/api-token', body)).token; tokInput.value = token; m2(done); } catch (e) { m2('✗ ' + e.message); }
    };
    document.getElementById('savetok').onclick = () => {
      const t = tokInput.value.trim();
      if (t === token) return m2('Token 没有改动');
      setToken('PUT', { token: t }, '已保存，请把扩展和油猴脚本里的 Token 换成新的。');
    };
    document.getElementById('regen').onclick = () => setToken('POST', null, '已随机生成新 Token，请把扩展和油猴脚本里的 Token 换成新的。');
    document.getElementById('chg').onclick = async () => {
      const m3 = (t) => (document.getElementById('m3').textContent = t);
      try { await savePassword(); ['cur', 'np1', 'np2'].forEach((id) => (document.getElementById(id).value = '')); m3('已修改 ✓'); } catch (e) { m3('✗ ' + e.message); }
    };
    document.getElementById('logout').onclick = logout;
  }

  /* ---------- router ---------- */
  const PAGES = { words: pageWords, phrases: pagePhrases, roots: pageRoots, articles: pageArticles, quiz: pageQuiz, wrong: () => pageWrong(), stats: pageStats, reader: pageReader, settings: pageSettings };
  async function route() {
    if (!(await ensureAuth())) return;
    const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'words';
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + name));
    document.onkeydown = null;
    if (name !== 'reader') { ERA.pageMetaOverride = null; ERA.annotKey = null; }
    try { await (PAGES[name] || pageWords)(); } catch (e) {
      if (/未授权/.test(e.message)) { localStorage.removeItem('era_token'); return route(); }
      if (/修改默认密码/.test(e.message)) return route();
      $app.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
    }
  }
  window.addEventListener('hashchange', route);
  ERA.init(WebP, { restore: false }).then(route);
})();
