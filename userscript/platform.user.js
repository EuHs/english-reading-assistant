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
/** Bundled @resource (Tampermonkey) or one download from the CDN; the page fetch lets Safari's HTTP cache keep it. */
async function loadDict() {
  if (dictData) return true;
  if (dictLoading) return dictLoading;
  dictLoading = (async () => {
    const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    dictData = parse(GMX.resource('dict'));
    rootsData = parse(GMX.resource('roots'));
    if (!dictData) {
      const get = async (f, timeout) => {
        try { const r = await fetch(DICT_CDN + f); if (r.ok) return await r.json(); } catch (e) { /* CSP or offline: try the manager */ }
        const r = await gmRequest({ url: DICT_CDN + f, timeout });
        return r.ok ? parse(r.text) : null;
      };
      const slow = setTimeout(() => ERA.UI.toast('首次查词：正在下载离线词典（约 7 MB）…', 4000), 800);
      [dictData, rootsData] = await Promise.all([get('dict.json', 90000), get('roots.json', 30000)]);
      clearTimeout(slow);
    }
    if (!dictData) dictLoading = null; // allow a retry later
    return !!dictData;
  })();
  return dictLoading;
}
const hasBundledDict = () => !!GMX.resource('dict');

const P = {
  name: 'userscript',
  async getConfig() { return ERA.mergeConfig(ERA.defaultConfig(), (await GMX.get('config', {})) || {}); },
  async setConfig(c) { await GMX.set('config', c); },
  getData: (k, d) => GMX.get(k, d),
  setData: (k, v) => GMX.set(k, v),
  request: (o) => gmRequest(o),
  async lookup(word) {
    // without a bundled dictionary, ask the configured server first instead of downloading 7 MB on a phone
    const cfg = await P.getConfig();
    const viaServer = async () => {
      if (!cfg.server.enabled || !cfg.server.baseUrl) return null;
      try { return await ERA.serverCall('GET', (cfg.server.endpoints.dict || '/api/dict') + '/' + encodeURIComponent(word), null, cfg); } catch (e) { return null; }
    };
    if (!hasBundledDict() && !dictData) { const r = await viaServer(); if (r) return r; }
    if (await loadDict()) return ERA.dictLookup(dictData, rootsData, word);
    return viaServer();
  },
};

/* ---------- PDF overlay reader (mobile friendly) ---------- */
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
const PDFJS_WORKER = PDFJS_CDN + 'pdf.worker.min.js';
/**
 * The @require copy is missing when the manager skipped it, or when the page has an AMD define()
 * (common on desktop sites, which iPad Safari gets): pdf.js then registers with that loader instead
 * of setting pdfjsLib. Fall back to loading it with module/exports/define shadowed.
 */
let pdfjsLoading = null;
function ensurePdfjs() {
  if (typeof pdfjsLib !== 'undefined') return Promise.resolve(true);
  pdfjsLoading = pdfjsLoading || (async () => {
    let code = null;
    try { const r = await fetch(PDFJS_CDN + 'pdf.min.js'); if (r.ok) code = await r.text(); } catch (e) { /* CSP: try the manager */ }
    if (!code) { const r = await gmRequest({ url: PDFJS_CDN + 'pdf.min.js', timeout: 60000 }); code = r.ok ? r.text : null; }
    if (!code) throw new Error('下载 pdf.js 失败');
    const mod = { exports: {} };
    new Function('module', 'exports', 'define', code)(mod, mod.exports, undefined);
    if (!mod.exports.getDocument) throw new Error('pdf.js 初始化失败');
    globalThis.pdfjsLib = mod.exports;
    return true;
  })().catch((e) => { pdfjsLoading = null; throw e; });
  return pdfjsLoading;
}

async function openPdfOverlay(source) {
  try { await ensurePdfjs(); } catch (e) { return ERA.UI.toast('pdf.js 未加载，无法打开 PDF：' + e.message, 5000); }
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

/* ---------- menu: script-manager menu and/or a floating button ---------- */
const MENU = [
  ['⚙️ 设置（AI / 服务器 / 导入导出）', () => ERA.Settings.openPanel()],
  ['📒 生词本 / 好词好句', () => ERA.UI.showBook()],
  ['📂 打开本地 PDF', pickLocalPdf],
  ['📄 用阅读器打开 PDF 链接', () => { const u = prompt('PDF 链接：', /\.pdf/i.test(location.href) ? location.href : ''); if (u) openPdfOverlay(u); }],
  ['👁 显示 / 隐藏生词标记', () => ERA.toggleBookMarks()],
  ['🔄 同步到服务器', async () => { const r = await ERA.Store.flush(); ERA.UI.toast(r.reason === 'server-disabled' ? '请先在设置中启用服务器' : r.synced ? `同步完成 ${r.ok} 条` : `待同步 ${r.pending} 条：${r.error}`); }],
];
const hasMenuApi = typeof GM_registerMenuCommand === 'function' || (typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function');

const FAB_CSS = `:host{all:initial}
.fab{position:fixed;right:6px;width:38px;height:38px;border-radius:50%;background:rgba(17,24,39,.55);color:#fff;font:600 15px/38px -apple-system,system-ui,sans-serif;text-align:center;
  box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent}
.fab.open{background:#111827}
.menu{position:fixed;right:50px;min-width:210px;background:#fff;color:#111827;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:6px;font:14px/1.4 -apple-system,system-ui,sans-serif}
.menu button{all:unset;display:block;box-sizing:border-box;width:100%;padding:10px 12px;border-radius:8px;cursor:pointer}
.menu button:active,.menu button:hover{background:#f3f4f6}
.menu .muted{color:#6b7280;font-size:12px}
@media (prefers-color-scheme:dark){.menu{background:#1f2937;color:#f9fafb}.menu button:active,.menu button:hover{background:#374151}.menu .muted{color:#9ca3af}}`;

let fabHost = null;
async function updateFab(cfg) {
  const mode = (cfg || (await P.getConfig())).ui.fab || 'auto';
  // with no script-manager menu the button is the only way into settings, so it never goes away there
  const show = !hasMenuApi || mode === 'on' || (mode === 'auto' && matchMedia('(pointer:coarse)').matches);
  if (!show) { fabHost && fabHost.remove(); fabHost = null; return; }
  if (fabHost && fabHost.isConnected) return;
  fabHost = document.createElement('div');
  fabHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646';
  const root = fabHost.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${FAB_CSS}</style><div class="fab" title="英语阅读助手">英</div>`;
  document.documentElement.appendChild(fabHost);
  const fab = root.querySelector('.fab');
  const clampY = (y) => Math.max(8, Math.min(innerHeight - 46, y));
  let y = clampY(+(await GMX.get('fabY', 0)) || innerHeight * 0.62);
  fab.style.top = y + 'px';

  let menu = null;
  const close = () => { menu && menu.remove(); menu = null; fab.classList.remove('open'); };
  const open = () => {
    menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = MENU.map(([l], i) => `<button data-i="${i}">${l}</button>`).join('') +
      (hasMenuApi ? '<button data-i="hide" class="muted">隐藏此按钮（可在设置中恢复）</button>' : '<button data-i="hide" class="muted">本页暂时隐藏</button>');
    root.appendChild(menu);
    menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, y + 19 - menu.offsetHeight / 2)) + 'px';
    fab.classList.add('open');
    menu.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      close();
      if (b.dataset.i !== 'hide') return MENU[+b.dataset.i][1]();
      if (hasMenuApi) { const c = await P.getConfig(); c.ui.fab = 'off'; await P.setConfig(c); } else { fabHost.remove(); fabHost = null; }
    };
  };

  // drag vertically to move it out of the way; a short tap opens the menu
  let start = null;
  fab.addEventListener('pointerdown', (e) => { start = { py: e.clientY, y, moved: false }; fab.setPointerCapture(e.pointerId); e.preventDefault(); });
  fab.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (Math.abs(e.clientY - start.py) > 6) start.moved = true;
    if (start.moved) { close(); y = clampY(start.y + e.clientY - start.py); fab.style.top = y + 'px'; }
  });
  fab.addEventListener('pointerup', () => {
    if (!start) return;
    if (start.moved) GMX.set('fabY', Math.round(y)); else if (menu) close(); else open();
    start = null;
  });
  fab.addEventListener('pointercancel', () => { start = null; });
  document.addEventListener('pointerdown', (e) => { if (menu && !e.composedPath().includes(fabHost)) close(); }, true);
  addEventListener('resize', () => { y = clampY(y); fab.style.top = y + 'px'; });
}

(async function main() {
  if (window.top !== window.self) return;
  ERA.P = P;
  await ERA.init(P);
  for (const [label, fn] of MENU) GMX.menu(label, fn);
  const setConfig = P.setConfig;
  P.setConfig = async (c) => { await setConfig(c); updateFab(c); };
  updateFab();
  if (document.contentType === 'application/pdf') openPdfOverlay(location.href);
  decoratePdfLinks();
  new MutationObserver(() => { clearTimeout(decoratePdfLinks.t); decoratePdfLinks.t = setTimeout(decoratePdfLinks, 800); }).observe(document.body, { childList: true, subtree: true });
})();
