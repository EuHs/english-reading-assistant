/* Extension PDF viewer page. */
(async function () {
  const api = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : chrome;
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';
  const $ = (id) => document.getElementById(id);
  const reader = $('reader');
  const R = ERA.PdfReader;
  const setZoom = () => ($('zoomVal').textContent = Math.round(R.scale * 100) + '%');

  async function openData(data, info) {
    try {
      const pdf = await R.open(reader, data, info);
      $('title').textContent = ERA.pageMetaOverride.title;
      $('pageCount').textContent = '/ ' + pdf.numPages;
      $('pageNo').max = pdf.numPages;
      setZoom();
    } catch (e) {
      reader.innerHTML = `<div style="color:#fff;padding:40px;text-align:center">PDF 打开失败：${ERA.escapeHtml(e.message)}</div>`;
    }
  }

  async function openUrl(url) {
    reader.innerHTML = '<div style="color:#fff;text-align:center;padding:40px">正在下载 PDF…</div>';
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await openData(await res.arrayBuffer(), { url, name: decodeURIComponent(url.split('/').pop().split('?')[0]) });
    } catch (e) {
      const fileHint = url.startsWith('file:') ? '<br>本地文件：请在扩展管理页开启“允许访问文件网址”，或点击左上角“打开”选择文件。' : '';
      reader.innerHTML = `<div style="color:#fff;padding:40px;text-align:center">无法加载：${ERA.escapeHtml(e.message)}${fileHint}<br><a style="color:#93c5fd" href="${ERA.escapeHtml(url)}" data-raw>在浏览器原生查看器中打开</a></div>`;
      reader.querySelector('[data-raw]').onclick = async (ev) => {
        ev.preventDefault();
        const cfg = await ERA.P.getConfig();
        cfg.ui.pdfIntercept = false; // avoid redirect loop; user can re-enable in settings
        await ERA.P.setConfig(cfg);
        location.href = url;
      };
    }
  }

  const openFile = async (f) => f && openData(await f.arrayBuffer(), { name: f.name });
  $('file').onchange = (e) => openFile(e.target.files[0]);
  $('zoomIn').onclick = () => { R.zoom(1.15); setZoom(); };
  $('zoomOut').onclick = () => { R.zoom(1 / 1.15); setZoom(); };
  $('pageNo').onchange = (e) => R.goto(+e.target.value);
  $('book').onclick = () => ERA.UI.showBook();
  $('settings').onclick = () => api.runtime.openOptionsPage();
  window.addEventListener('scroll', () => {
    const mid = window.innerHeight / 3;
    const p = R.pages.find((x) => { const r = x.div.getBoundingClientRect(); return r.bottom > mid; });
    if (p && document.activeElement !== $('pageNo')) $('pageNo').value = p.n;
  }, { passive: true });
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); $('drop').hidden = false; }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === $('drop')) $('drop').hidden = true; }));
  document.addEventListener('drop', (e) => openFile(e.dataTransfer.files[0]));

  const file = new URLSearchParams(location.search).get('file');
  if (file) openUrl(file);
})();
