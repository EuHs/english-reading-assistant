/* Options page: settings form + local vocab/phrase book. */
(async function () {
  const $ = (id) => document.getElementById(id);
  $('ver').textContent = 'v' + ERA.VERSION;
  const st = document.createElement('style');
  st.textContent = ERA.SETTINGS_CSS;
  document.head.appendChild(st);
  ERA.Settings.render($('settings'));
  const esc = ERA.escapeHtml;

  async function renderWords() {
    const words = await ERA.Store.words();
    $('words').innerHTML = `<div class="muted">本机保存过的全部生词（所有文章），用于导出备份和上传服务器。阅读时点页面上的「本文生词本」看这篇文章的生词；复习全部生词请到服务器网页。</div>
      <div class="btns"><button class="btn gh" data-x="csv">导出 CSV</button><button class="btn gh" data-x="json">导出 JSON</button><button class="btn gh" data-x="sync">上传到服务器</button><span class="muted">共 ${words.length} 个生词</span><span class="muted" id="wmsg"></span></div>
      <table><tr><th>单词</th><th>释义 / 词根</th><th>例句与文章</th><th></th></tr>
      ${words.map((w) => `<tr><td><b>${esc(w.word)}</b><div class="muted">${esc(w.lemma)} ${w.phonetic ? '/' + esc(w.phonetic) + '/' : ''}</div></td>
        <td>${esc(w.meaning || '')}<div class="muted">${esc((w.translation || '').slice(0, 100))}</div>${(w.roots || []).length ? `<div class="muted">词根：${w.roots.map(esc).join(', ')}</div>` : ''}</td>
        <td>${(w.occurrences || []).map((o) => `<div class="sentence">${ERA.highlightWord(o.sentence, o.surface)}</div><div class="muted">${esc(o.sentence_translation || '')}</div><div class="muted">— ${esc((o.article || {}).title || '')}</div>`).join('')}</td>
        <td><button class="btn gh" data-del="${w.id}">删除</button></td></tr>`).join('')}</table>`;
  }
  async function renderPhrases() {
    const ps = await ERA.Store.phrases();
    $('phrases').innerHTML = `<div class="muted">共 ${ps.length} 条</div><table><tr><th>好词好句</th><th>翻译</th><th>来源</th><th></th></tr>
      ${ps.map((p) => `<tr><td>${esc(p.text)}${p.kind !== 'sentence' ? `<div class="sentence">${ERA.highlightWord(p.sentence, p.text)}</div>` : ''}</td><td>${esc(p.translation)}<div class="muted">${p.kind !== 'sentence' ? esc(p.sentence_translation || '') : ''}</div></td>
      <td class="muted">${esc((p.article || {}).title || '')}<br>${esc((p.article || {}).author || '')}</td><td><button class="btn gh" data-pdel="${p.id}">删除</button></td></tr>`).join('')}</table>`;
  }
  document.querySelector('.tabs').onclick = (e) => {
    const t = e.target.dataset.t;
    if (!t) return;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    ['settings', 'words', 'phrases', 'help'].forEach((id) => ($(id).hidden = id !== t));
    if (t === 'words') renderWords();
    if (t === 'phrases') renderPhrases();
  };
  document.addEventListener('click', async (e) => {
    const d = e.target.dataset;
    const everywhere = '会删除它在本机和服务器上的全部记录（所有文章）。只取消某篇文章里的标记，请在那篇文章的「本文生词本」里点 ×。确定删除？';
    if (d.del) { if (!confirm(everywhere)) return; await ERA.Store.removeWord(d.del); renderWords(); }
    if (d.pdel) { if (!confirm(everywhere)) return; await ERA.Store.removePhrase(d.pdel); renderPhrases(); }
    if (d.x === 'csv') ERA.download('era-vocab.csv', ERA.Store.toCSV(await ERA.Store.words()), 'text/csv');
    if (d.x === 'json') ERA.download('era-book.json', await ERA.Store.exportAll(), 'application/json');
    if (d.x === 'sync') { $('wmsg').textContent = '上传中…'; $('wmsg').textContent = ERA.Store.syncMessage(await ERA.Store.syncAll()); }
  });
  if (location.hash === '#words') document.querySelector('[data-t=words]').click();
})();
