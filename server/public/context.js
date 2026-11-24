/* AI context reading, persistent reading answers and native vocabulary consolidation. */
(function () {
  let ui, serial = 0, setupSerial = 0, poll = null, current = null, translated = false, busy = false;
  const app = () => document.getElementById('app');
  const esc = (s) => ui.esc(s == null ? '' : String(s));
  const query = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const stamp = (s) => new Date(s && !s.includes('T') ? s.replace(' ', 'T') + 'Z' : s).toLocaleString('zh-CN', { hour12: false });
  const gloss = (w) => (w.meaning || w.translation || '').split('\n')[0];
  const level = (s) => ({ easy: '简单', medium: '适中 · 四级', hard: '挑战' }[s] || s);
  const stop = () => { ++serial; clearTimeout(poll); busy = false; };
  const resume = (id) => { const hash = '#/context/' + id; if (location.hash === hash) ui.route(); else location.hash = hash; };

  async function open(options = {}) {
    const seq = ++setupSerial;
    const body = ui.modal('<div id="context-setup-loading" role="status">正在读取生词…</div>');
    try {
      const data = await ui.api('GET', '/api/contexts/options?' + query(options));
      if (seq !== setupSerial || document.getElementById('modal').hidden || !body.querySelector('#context-setup-loading')) return;
      const selected = new Set(data.words.slice(0, Math.min(10, data.words.length)).map((w) => w.id));
      const requestKey = window.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
      body.innerHTML = `<div class="context-setup"><h2>AI 语境助记</h2><p class="muted">把选中的生词编成短文，再通过阅读和选择题巩固。每篇 1–${data.max_words} 个词，生成后自动保存。</p>
        <fieldset><legend>短文主题</legend><div class="chips">${data.topics.map((t, i) => `<label class="context-radio"><input type="radio" name="context-topic" value="${esc(t)}" ${i ? '' : 'checked'}> ${esc(t)}</label>`).join('')}</div></fieldset>
        <fieldset><legend>文章难度</legend><div class="chips">${Object.entries(data.levels).map(([key, label]) => `<label class="context-radio"><input type="radio" name="context-level" value="${key}" ${key === 'medium' ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div></fieldset>
        <div class="bar"><b>本篇生词 <span id="context-selected-count">${selected.size}</span> / ${data.max_words}</b><span style="flex:1"></span><button class="btn gh sm" id="context-pick-ten">选前 10 个</button><button class="btn gh sm" id="context-clear">清空</button></div>
        <div class="context-word-picker">${data.words.map((w) => `<label><input type="checkbox" data-context-pick="${w.id}" ${selected.has(w.id) ? 'checked' : ''}><b>${esc(w.lemma)}</b><span class="muted">${esc(gloss(w).slice(0, 55))}</span></label>`).join('') || '<p class="muted">该范围内没有生词。可返回“语境助记”页，选择“全部生词”。</p>'}</div>
        <p class="muted">只发送所选单词和释义，使用已配置的服务器 AI。生成通常需要几十秒，可离开页面后再继续。</p>
        <div id="context-setup-msg" role="status" class="muted">${data.ai_ready ? '' : '尚未配置 AI，请先到设置中完成配置。'}</div>
        <div class="bar"><button class="btn" id="context-generate" ${data.ai_ready && selected.size ? '' : 'disabled'}>开始生成短文</button><button class="btn gh" id="context-cancel">取消</button></div></div>`;
      const update = () => {
        body.querySelector('#context-selected-count').textContent = selected.size;
        body.querySelector('#context-generate').disabled = !data.ai_ready || !selected.size;
        body.querySelectorAll('[data-context-pick]').forEach((b) => (b.checked = selected.has(+b.dataset.contextPick)));
      };
      body.querySelectorAll('[data-context-pick]').forEach((b) => (b.onchange = () => {
        if (b.checked && selected.size >= data.max_words) { b.checked = false; body.querySelector('#context-setup-msg').textContent = `每篇最多 ${data.max_words} 个词，请先取消一些。`; return; }
        if (b.checked) selected.add(+b.dataset.contextPick); else selected.delete(+b.dataset.contextPick);
        update();
      }));
      body.querySelector('#context-pick-ten').onclick = () => { selected.clear(); data.words.slice(0, 10).forEach((w) => selected.add(w.id)); update(); };
      body.querySelector('#context-clear').onclick = () => { selected.clear(); update(); };
      body.querySelector('#context-cancel').onclick = () => { ++setupSerial; document.getElementById('modal').hidden = true; };
      body.querySelector('#context-generate').onclick = async (e) => {
        const button = e.currentTarget;
        if (button.disabled) return;
        button.disabled = true; button.textContent = '正在创建练习…';
        const params = { word_ids: [...selected], topic: body.querySelector('[name="context-topic"]:checked').value,
          difficulty: body.querySelector('[name="context-level"]:checked').value, request_key: requestKey,
          ...(options.quiz_id ? { source_quiz_id: +options.quiz_id } : {}) };
        try {
          const study = await ui.api('POST', '/api/contexts', params);
          if (seq === setupSerial && button.isConnected && !document.getElementById('modal').hidden) {
            document.getElementById('modal').hidden = true;
            location.hash = '#/context/' + study.id;
          } else ui.toast('短文正在后台生成，可从“语境助记”页继续。');
        } catch (err) {
          if (seq === setupSerial && button.isConnected) { body.querySelector('#context-setup-msg').textContent = err.message; button.disabled = false; button.textContent = '重试创建练习'; }
        }
      };
    } catch (e) {
      if (seq === setupSerial && !document.getElementById('modal').hidden && body.querySelector('#context-setup-loading')) body.innerHTML = `<p role="alert">${esc(e.message)}</p>`;
    }
  }

  async function page() {
    stop(); translated = false;
    const view = serial, id = (location.hash.match(/^#\/context\/(\d+)/) || [])[1];
    if (id) return load(+id, view);
    const items = await ui.api('GET', '/api/contexts');
    if (view !== serial) return;
    app().innerHTML = `<div class="context-home"><h2>AI 语境助记</h2><p class="muted">用自己的生词读一篇短文：语境精读 → 阅读小测 → 单词选择巩固。短文、答案和进度自动保存。</p>
      <div class="card bar"><label for="context-scope">生词来源</label><select id="context-scope"><option value="due">到期生词</option><option value="wrong">错题集</option><option value="all">全部生词</option></select><button class="btn" id="context-new">新建语境练习</button></div>
      <h3>历史短文</h3><div class="grid">${items.map((s) => `<article class="card"><span class="tag">${esc(s.topic)}</span><span class="tag">${esc(level(s.difficulty))}</span><h3>${esc(s.title)}</h3><p class="muted">${s.word_count} 个生词 · ${esc(stamp(s.created_at))}</p>
        <p class="muted">${s.status === 'generating' ? '正在生成，可稍后继续' : s.status === 'failed' ? esc(s.error) : '短文与学习进度已保存'}</p><a class="btn gh" href="#/context/${s.id}">${s.status === 'failed' ? '查看并重试' : '继续学习'}</a></article>`).join('') || '<div class="empty">还没有短文，先选一组生词开始。</div>'}</div></div>`;
    document.getElementById('context-new').onclick = () => open({ scope: document.getElementById('context-scope').value });
  }

  async function load(id, view) {
    const study = await ui.api('GET', '/api/contexts/' + id);
    if (view !== serial) return;
    current = study;
    if (study.status === 'ready') return draw();
    app().innerHTML = `<div class="quiz"><h2>AI 语境助记</h2><div class="card context-loading" role="status" aria-live="polite">${study.status === 'generating' ? '<span class="context-spinner" aria-hidden="true"></span><h3>正在编写这组词的故事…</h3><p>生成短文、翻译和 3 道阅读题，完成后会自动打开。</p><p class="muted">可以返回列表，生成会在后台继续。刷新或重新打开也能找到本篇。</p>' : `<h3>本次未生成成功</h3><p>${esc(study.error)}</p><button class="btn" id="context-retry">重试生成</button>`}<p><a href="#/context">返回历史短文</a></p></div></div>`;
    if (study.status === 'generating') poll = setTimeout(() => load(id, view).catch((e) => { if (view === serial) app().innerHTML = `<div class="card" role="alert">暂时无法连接服务器。重新打开本篇即可继续。<p>${esc(e.message)}</p><a href="#/context">返回历史短文</a></div>`; }), 1500);
    else document.getElementById('context-retry').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await ui.api('POST', `/api/contexts/${id}/retry`); if (view === serial) load(id, view).catch((e) => ui.toast(e.message)); }
      catch (err) { if (view === serial) { ui.toast(err.message); document.getElementById('context-retry').disabled = false; } }
    };
  }

  function highlighted(s, words) {
    const literals = words.map((w) => w.lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
    const re = new RegExp(`(?<![A-Za-z])(${literals.join('|')})(?![A-Za-z])`, 'gi');
    let start = 0, out = '';
    for (const m of s.matchAll(re)) {
      const w = words.find((w) => w.lemma.toLowerCase() === m[0].toLowerCase());
      out += esc(s.slice(start, m.index)) + `<button class="context-word" data-context-word="${w.id}" title="查看 ${esc(w.lemma)} 的词义与语境提示">${esc(m[0])}</button>`;
      start = m.index + m[0].length;
    }
    return out + esc(s.slice(start));
  }

  function dictionary(id) {
    const w = current.words.find((w) => w.id === +id);
    const hint = current.content.mnemonics.find((m) => m.word_id === w.id)?.hint;
    const body = ui.modal(`<h2>${esc(w.lemma)} <button class="spk" data-speak="${esc(w.lemma)}" title="朗读">🔊</button></h2><p class="ph">${esc(w.phonetic || '')}</p><p>${esc(gloss(w))}</p>${hint ? `<div class="sec"><h4>语境提示</h4><p>${esc(hint)}</p></div>` : ''}<button class="btn gh" id="context-word-detail">查看完整词典与出处</button>`);
    body.querySelector('#context-word-detail').onclick = () => ui.showWord(w.id).catch(() => ui.toast('该词已移出生词本；本篇仍保留生成时的释义。'));
  }

  function draw() {
    const s = current, scroll = window.scrollY;
    const panelScroll = document.getElementById('context-reading')?.scrollTop || 0;
    app().innerHTML = `<div class="context-work"><div class="bar context-toolbar"><a href="#/context">历史短文</a><span class="tag">${esc(s.topic)}</span><span class="tag">${esc(level(s.difficulty))}</span><span class="muted">本篇 ${s.words.length} 个生词</span></div>
      <div class="context-columns"><article class="card context-passage"><div class="bar context-title"><h2>${esc(s.content.title)}</h2><button class="btn gh sm" id="context-translate" aria-pressed="${translated}">${translated ? '隐藏翻译' : '显示翻译'}</button></div><p class="muted">点击高亮词，查看词义和语境提示。</p>
        ${s.content.paragraphs.map((p) => `<p class="context-en">${highlighted(p.en, s.words)}</p><p class="context-zh" ${translated ? '' : 'hidden'}>${esc(p.zh)}</p>`).join('')}
        ${s.analysis_viewed ? `<section class="sec"><h3>阅读题解析</h3>${s.questions.map((q) => `<div class="context-analysis"><h4>${q.idx + 1}. ${esc(q.prompt)}</h4><p>正确答案：${String.fromCharCode(65 + q.answer)}. ${esc(q.options[q.answer])}</p><p>${esc(q.explanation)}</p><blockquote>${esc(q.evidence)}</blockquote></div>`).join('')}</section>` : ''}</article>
      <aside class="card context-reading" id="context-reading"><div class="bar"><h3>阅读小测</h3><span class="muted">已答 ${s.reading.answered} / ${s.reading.total}</span></div>
        <div class="bar"><button class="btn gh sm" id="context-analysis">${s.analysis_viewed ? '解析已显示' : '查看解析'}</button><button class="btn sm" id="context-consolidate">${s.consolidation_quiz_id ? '继续巩固 / 查看结果' : '进入选择巩固'}</button></div>
        <p class="muted">阅读小测可跳过。看过解析后再答的题会注明；最后的单词巩固题才参与复习排期。</p>
        ${s.questions.map((q) => `<fieldset class="context-question"><legend>${q.idx + 1}. ${esc(q.prompt)}</legend><div class="opts">${q.options.map((o, k) => `<button class="opt ${q.chosen != null && q.answer === k ? 'right' : q.chosen === k && !q.correct ? 'wrong' : ''}" data-reading-idx="${q.idx}" data-reading-choice="${k}" ${q.chosen != null ? 'disabled' : ''}><b>${String.fromCharCode(65 + k)}</b>${esc(o)}</button>`).join('')}</div>
          ${q.chosen != null ? `<div class="feedback" role="status">${q.correct ? '答对了' : '本题答错了'} · 你的选择 ${String.fromCharCode(65 + q.chosen)}<p>${esc(q.explanation)}</p><p class="muted">原文：${esc(q.evidence)}</p></div>` : ''}</fieldset>`).join('')}
        <div id="context-reading-message" role="status"></div></aside></div></div>`;
    document.getElementById('context-reading').scrollTop = panelScroll;
    if (window.scrollY !== scroll) window.scrollTo(0, scroll);
    document.getElementById('context-translate').onclick = (e) => {
      translated = !translated;
      e.currentTarget.textContent = translated ? '隐藏翻译' : '显示翻译'; e.currentTarget.setAttribute('aria-pressed', translated);
      app().querySelectorAll('.context-zh').forEach((p) => (p.hidden = !translated));
    };
    app().querySelectorAll('[data-context-word]').forEach((b) => (b.onclick = () => dictionary(b.dataset.contextWord)));
    app().querySelectorAll('[data-reading-choice]').forEach((b) => (b.onclick = () => mutate('reading-answer', { idx: +b.dataset.readingIdx, choice: +b.dataset.readingChoice })));
    document.getElementById('context-analysis').onclick = () => mutate('analysis');
    document.getElementById('context-consolidate').onclick = () => mutate('consolidate');
  }

  async function mutate(action, body) {
    if (busy) return;
    const view = serial, id = current.id;
    busy = true;
    const panel = document.getElementById('context-reading');
    panel.querySelectorAll('button').forEach((b) => (b.disabled = true));
    document.getElementById('context-reading-message').textContent = '正在保存…';
    try {
      const value = await ui.api('POST', `/api/contexts/${id}/${action}`, body);
      if (view !== serial) return;
      busy = false;
      if (action === 'consolidate') { ++serial; return ui.runQuiz(value); }
      current = value; draw();
    } catch (e) { if (view === serial) { busy = false; draw(); document.getElementById('context-reading-message').textContent = '保存失败：' + e.message + '，可重试。'; } }
  }

  async function result(quiz) {
    stop();
    const view = serial, s = await ui.api('GET', '/api/contexts/' + quiz.context_id);
    if (view !== serial) return;
    const right = quiz.questions.filter((q) => q.correct).length;
    app().innerHTML = `<div class="quiz context-result"><h2>语境学习完成</h2><p>${esc(s.content.title)}</p><div class="card"><div class="stats"><div class="stat"><b>${s.words.length}</b>本篇生词</div><div class="stat"><b>${s.reading.correct} / ${s.reading.total}</b>阅读小测</div><div class="stat"><b>${right} / ${quiz.total}</b>单词巩固</div></div>
      <p class="muted">阅读已答 ${s.reading.answered} 题${s.reading.assisted ? `，其中 ${s.reading.assisted} 题在查看解析后作答` : ''}。巩固题已按现有复习规则记录；提前答对保留原日期，答错立即待复习。</p>
      <div class="bar"><a class="btn" id="context-reread" href="#/context/${s.id}">重读短文</a><a class="btn gh" href="#/context">历史短文</a>${quiz.wrong.length ? '<button class="btn gh" id="context-review-wrong">复习错词</button><button class="btn gh" id="context-retest-wrong">再巩固错词</button>' : ''}</div></div>
      <h3>下次复习安排</h3><div class="card review-list">${quiz.questions.map((q) => `<div><span>${esc(q.word.lemma)}${q.chosen == null ? '（未作答）' : ''}</span>${ui.reviewTime(q.review)}</div>`).join('')}</div></div>`;
    const refresh = async () => { try { await result(await ui.api('POST', `/api/quiz/${quiz.id}/finish`)); } catch (e) { ui.toast(e.message); } };
    document.getElementById('context-reread').onclick = (e) => { e.preventDefault(); resume(s.id); };
    if (quiz.wrong.length) {
      document.getElementById('context-review-wrong').onclick = () => ui.reviewCards(quiz.wrong.map((q) => q.detail), refresh);
      document.getElementById('context-retest-wrong').onclick = () => ui.localRetest(quiz, refresh);
    }
  }

  ERA.ContextUI = { init: (helpers) => (ui = helpers), open, page, leave: stop, result, resume };
})();
