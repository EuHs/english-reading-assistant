/* Userscript platform adapter (Tampermonkey / Violentmonkey / Userscripts for Safari iOS). */
const GMX = {
  get: typeof GM_getValue === 'function' ? async (k, d) => GM_getValue(k, d) : async (k, d) => GM.getValue(k, d),
  set: typeof GM_setValue === 'function' ? async (k, v) => GM_setValue(k, v) : async (k, v) => GM.setValue(k, v),
  xhr: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : typeof GM !== 'undefined' && GM.xmlHttpRequest ? GM.xmlHttpRequest : null,
  resource(name) {
    try { if (typeof GM_getResourceText === 'function') return GM_getResourceText(name); } catch (e) { /* not provided */ }
    return null;
  },
  menu(label, fn) {
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
    else if (typeof GM !== 'undefined' && GM.registerMenuCommand) GM.registerMenuCommand(label, fn);
  },
};

const DICT_CDN = 'https://cdn.jsdelivr.net/gh/EuHs/english-reading-assistant@main/dist/';

function gmRequest(o, responseType) {
  return new Promise((resolve) => {
    if (!GMX.xhr) {
      fetch(o.url, { method: o.method || 'GET', headers: o.headers, body: o.body })
        .then(async (r) => resolve({ ok: r.ok, status: r.status, text: responseType ? null : await r.text(), response: responseType ? await r.arrayBuffer() : null }))
        .catch((e) => resolve({ ok: false, status: 0, text: '网络错误：' + e.message }));
      return;
    }
    GMX.xhr({
      method: o.method || 'GET', url: o.url, headers: o.headers || {}, data: o.body, timeout: o.timeout || 60000,
      responseType: responseType || undefined, anonymous: false,
      onload: (r) => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: responseType ? null : r.responseText, response: r.response }),
      onerror: () => resolve({ ok: false, status: 0, text: '网络错误（检查地址，或在脚本管理器中允许跨域 @connect）' }),
      ontimeout: () => resolve({ ok: false, status: 0, text: '请求超时' }),
    });
  });
}

let dictData = null, rootsData = null, dictLoading = null;
async function loadDict() {
  if (dictData) return true;
  if (dictLoading) return dictLoading;
  dictLoading = (async () => {
    const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    dictData = parse(GMX.resource('dict'));
    rootsData = parse(GMX.resource('roots'));
    if (!dictData) {
      const r = await gmRequest({ url: DICT_CDN + 'dict.json', timeout: 60000 });
      dictData = r.ok ? parse(r.text) : null;
      const rr = await gmRequest({ url: DICT_CDN + 'roots.json', timeout: 30000 });
      rootsData = rr.ok ? parse(rr.text) : null;
    }
    return !!dictData;
  })();
  return dictLoading;
}

const P = {
  name: 'userscript',
  async getConfig() { return ERA.mergeConfig(ERA.defaultConfig(), (await GMX.get('config', {})) || {}); },
  async setConfig(c) { await GMX.set('config', c); },
  getData: (k, d) => GMX.get(k, d),
  setData: (k, v) => GMX.set(k, v),
  request: (o) => gmRequest(o),
  async lookup(word) {
    if (await loadDict()) return ERA.dictLookup(dictData, rootsData, word);
    // last resort: the configured server's dictionary
    const cfg = await P.getConfig();
    if (cfg.server.enabled) {
      try { return await ERA.serverCall('GET', (cfg.server.endpoints.dict || '/api/dict') + '/' + encodeURIComponent(word), null, cfg); } catch (e) { /* offline */ }
    }
    return null;
  },
};

/* ---------- PDF overlay reader (mobile friendly) ---------- */
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
async function openPdfOverlay(source) {
  if (typeof pdfjsLib === 'undefined') return ERA.UI.toast('pdf.js 未加载，无法打开 PDF');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  document.getElementById('era-pdf-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'era-pdf-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#525659;display:flex;flex-direction:column;font:14px sans-serif';
  ov.innerHTML = `<div style="display:flex;gap:6px;align-items:center;padding:6px 8px;background:#2b2d31;color:#eee;flex-wrap:wrap">
      <button data-a="close" style="all:unset;cursor:pointer;padding:4px 10px;background:#3a3d43;border-radius:6px">✕ 关闭</button>
      <span data-t style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">PDF</span>
      <button data-a="out" style="all:unset;cursor:pointer;padding:4px 10px;background:#3a3d43;border-radius:6px">－</button>
      <button data-a="in" style="all:unset;cursor:pointer;padding:4px 10px;background:#3a3d43;border-radius:6px">＋</button>
      <button data-a="book" style="all:unset;cursor:pointer;padding:4px 10px;background:#3a3d43;border-radius:6px">📒</button>
    </div><div data-body style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch"></div>`;
  document.body.appendChild(ov);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  const body = ov.querySelector('[data-body]');
  ov.querySelector('[data-a=close]').onclick = () => { ov.remove(); document.documentElement.style.overflow = prevOverflow; ERA.pageMetaOverride = null; ERA.annotKey = null; };
  ov.querySelector('[data-a=in]').onclick = () => ERA.PdfReader.zoom(1.15);
  ov.querySelector('[data-a=out]').onclick = () => ERA.PdfReader.zoom(1 / 1.15);
  ov.querySelector('[data-a=book]').onclick = () => ERA.UI.showBook();
  body.innerHTML = '<div style="color:#fff;text-align:center;padding:40px">正在加载 PDF…</div>';
  try {
    let data, info;
    if (source instanceof File) { data = await source.arrayBuffer(); info = { name: source.name }; }
    else {
      const r = await gmRequest({ url: source, timeout: 120000 }, 'arraybuffer');
      if (!r.ok || !r.response) throw new Error('下载失败 ' + r.status);
      data = r.response; info = { url: source, name: decodeURIComponent(source.split('/').pop().split('?')[0]) };
    }
    await ERA.PdfReader.open(body, data, info);
    ov.querySelector('[data-t]').textContent = ERA.pageMetaOverride.title;
  } catch (e) {
    body.innerHTML = `<div style="color:#fff;text-align:center;padding:40px">打开失败：${ERA.escapeHtml(e.message)}</div>`;
  }
}

function pickLocalPdf() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,.pdf';
  inp.onchange = () => inp.files[0] && openPdfOverlay(inp.files[0]);
  inp.click();
}

/** Small 📖 badge after every .pdf link: tap to read it in the study reader. */
function decoratePdfLinks(root) {
  (root || document).querySelectorAll('a[href]').forEach((a) => {
    if (a.dataset.eraPdf || !/\.pdf(?:$|[?#])/i.test(a.href)) return;
    a.dataset.eraPdf = '1';
    const b = document.createElement('span');
    b.textContent = '📖';
    b.title = '用英语阅读助手打开';
    b.style.cssText = 'cursor:pointer;margin-left:4px;font-size:0.95em;text-decoration:none';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPdfOverlay(a.href); });
    a.after(b);
  });
}

(async function main() {
  if (window.top !== window.self) return;
  ERA.P = P;
  await ERA.init(P);
  GMX.menu('⚙️ 设置（AI / 服务器 / 导入导出）', () => ERA.Settings.openPanel());
  GMX.menu('📒 生词本 / 好词好句', () => ERA.UI.showBook());
  GMX.menu('📂 打开本地 PDF', pickLocalPdf);
  GMX.menu('📄 用阅读器打开 PDF 链接', () => { const u = prompt('PDF 链接：', /\.pdf/i.test(location.href) ? location.href : ''); if (u) openPdfOverlay(u); });
  GMX.menu('👁 显示 / 隐藏生词标记', () => ERA.toggleBookMarks());
  GMX.menu('🔄 同步到服务器', async () => { const r = await ERA.Store.flush(); ERA.UI.toast(r.reason === 'server-disabled' ? '请先在设置中启用服务器' : r.synced ? `同步完成 ${r.ok} 条` : `待同步 ${r.pending} 条：${r.error}`); });
  if (document.contentType === 'application/pdf') openPdfOverlay(location.href);
  decoratePdfLinks();
  new MutationObserver(() => { clearTimeout(decoratePdfLinks.t); decoratePdfLinks.t = setTimeout(decoratePdfLinks, 800); }).observe(document.body, { childList: true, subtree: true });
})();
