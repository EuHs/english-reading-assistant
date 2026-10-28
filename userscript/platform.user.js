/* Userscript platform adapter (Tampermonkey / Violentmonkey / Userscripts for Safari iOS). */
const GMX = {
  get: typeof GM_getValue === 'function' ? async (k, d) => GM_getValue(k, d) : async (k, d) => GM.getValue(k, d),
  set: typeof GM_setValue === 'function' ? async (k, v) => GM_setValue(k, v) : async (k, v) => GM.setValue(k, v),
  xhr: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : typeof GM !== 'undefined' && GM.xmlHttpRequest ? GM.xmlHttpRequest : null,
  menu(label, fn) {
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
    else if (typeof GM !== 'undefined' && GM.registerMenuCommand) GM.registerMenuCommand(label, fn);
  },
};

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

/* ---------- downloads: the user's server first, then public CDNs (jsDelivr is often unreachable in mainland China) ---------- */
const REPO_CDNS = ['cdn', 'fastly', 'gcore'].map((h) => `https://${h}.jsdelivr.net/gh/EuHs/english-reading-assistant@main/dist/`);

async function sources(serverPath, publicUrls) {
  const cfg = await P.getConfig();
  const base = cfg.server.enabled && cfg.server.baseUrl ? cfg.server.baseUrl.replace(/\/+$/, '') : '';
  return [...(base ? [base + serverPath] : []), ...publicUrls];
}

/** Text of the first URL that answers; each gets its own timeout so one blocked host can't stall the rest. */
async function fetchFirst(urls, timeout) {
  const errs = [];
  for (const url of urls) {
    const r = await gmRequest({ url, timeout });
    if (r.ok && r.text && r.text.length > 100) return r.text;
    errs.push(url.split('/')[2] + (r.status ? ' HTTP ' + r.status : ' 无法连接'));
  }
  throw new Error(errs.join('；'));
}

let dictData = null, rootsData = null, dictLoading = null;
// Userscripts reads stored values only when asked, so the ~7 MB dictionary can be kept there and is downloaded
// once. Tampermonkey / Violentmonkey hand every stored value to every page, so there it stays in page memory.
const KEEP_DICT = typeof GM !== 'undefined' && !!GM.info && GM.info.scriptHandler === 'Userscripts';
const DICT_KEY = 'offlineDict.v1', DICT_FAILED_KEY = 'offlineDictFailed', DICT_RETRY_MS = 30 * 60 * 1000;

/** Offline dictionary into memory: the saved copy, else one download. Resolves 'memory' | 'saved' | 'downloaded'. */
function loadDict() {
  if (dictData) return Promise.resolve('memory');
  dictLoading = dictLoading || (async () => {
    const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    if (KEEP_DICT) {
      const saved = await GMX.get(DICT_KEY, null);
      if (saved && (dictData = parse(saved.dict))) { rootsData = parse(saved.roots); return 'saved'; }
    }
    // after a failed download wait a while instead of retrying on every lookup (unless the sources changed, e.g. a server was added)
    const bases = await sources('/data/', REPO_CDNS);
    const failed = await GMX.get(DICT_FAILED_KEY, null);
    if (failed && failed.from === bases.join(' ') && Date.now() - failed.at < DICT_RETRY_MS) throw new Error('recently failed');
    ERA.UI.toast(`正在下载离线词典（约 7 MB${KEEP_DICT ? '，只需下载一次' : ''}）…`, 4000);
    for (const base of bases) {
      const roots = await gmRequest({ url: base + 'roots.json', timeout: 15000 }); // small file first: is this host reachable?
      if (!roots.ok) continue;
      const dict = await gmRequest({ url: base + 'dict.json', timeout: 120000 });
      if (!(dictData = dict.ok ? parse(dict.text) : null)) continue;
      rootsData = parse(roots.text);
      if (KEEP_DICT) await GMX.set(DICT_KEY, { dict: dict.text, roots: roots.text, at: Date.now() }).catch(() => {});
      await GMX.set(DICT_FAILED_KEY, null);
      ERA.UI.toast(KEEP_DICT ? '离线词典已保存到本机，以后查词不用再下载' : '离线词典已下载', 3000);
      return 'downloaded';
    }
    await GMX.set(DICT_FAILED_KEY, { at: Date.now(), from: bases.join(' ') });
    throw new Error('download failed');
  })().catch((e) => { dictLoading = null; throw e; });
  return dictLoading;
}

async function downloadDictNow() {
  await GMX.set(DICT_FAILED_KEY, null);
  try { if ((await loadDict()) !== 'downloaded') ERA.UI.toast('离线词典已在本机，可直接查词', 2500); }
  catch (e) { ERA.UI.toast('离线词典下载失败：所有下载地址都连不上', 4000); }
}

const P = {
  name: 'userscript',
  async getConfig() { return ERA.mergeConfig(ERA.defaultConfig(), (await GMX.get('config', {})) || {}); },
  async setConfig(c) { await GMX.set('config', c); },
  getData: (k, d) => GMX.get(k, d),
  setData: (k, v) => GMX.set(k, v),
  request: (o) => gmRequest(o),
  async lookup(word) {
    const cfg = await P.getConfig();
    // with a server, look words up there instead of loading 7 MB on a phone
    if (!dictData && cfg.server.enabled && cfg.server.baseUrl) {
      try { const r = await ERA.serverCall('GET', (cfg.server.endpoints.dict || '/api/dict') + '/' + encodeURIComponent(word), null, cfg, 10000); if (r) return r; } catch (e) { /* server down: offline dictionary */ }
    }
    // a first download may take a while: it continues in the background and later lookups use it
    const state = await Promise.race([loadDict().then(() => 'ready', () => 'failed'), new Promise((res) => setTimeout(() => res('pending'), 8000))]);
    if (state === 'ready') return ERA.dictLookup(dictData, rootsData, word);
    return { word, found: false, error: state === 'pending' ? '离线词典下载中（约 7 MB），下载完再查即可。'
      : `离线词典下载失败：${cfg.server.enabled ? '服务器和 jsDelivr 都连不上' : 'jsDelivr 连不上，在设置里启用服务器后会改用服务器查词'}。可在菜单「📥 下载离线词典」重试。` };
  },
};

/* ---------- PDF overlay reader (mobile friendly) ---------- */
// pdf.js itself is bundled into this script (loadBundledPdfjs, appended by tools/build.mjs); only its ~1 MB
// parser worker is downloaded on first use — npmmirror is reachable in mainland China, jsDelivr often is not.
const PDFJS_VER = '3.11.174';
const WORKER_URLS = [
  `https://registry.npmmirror.com/pdfjs-dist/${PDFJS_VER}/files/build/pdf.worker.min.js`,
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.js`,
  `https://unpkg.com/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.js`,
];

function ensurePdfjs() {
  if (typeof pdfjsLib === 'undefined') globalThis.pdfjsLib = loadBundledPdfjs();
  if (!pdfjsLib.getDocument) throw new Error('pdf.js 初始化失败');
}

/** Can this page start a worker from a blob: URL? A strict CSP (worker-src / script-src) says no. */
function blobWorkerAllowed() {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
      const w = new Worker(url);
      const done = (ok) => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); resolve(ok); };
      const t = setTimeout(() => done(false), 3000);
      w.onmessage = () => done(true);
      w.onerror = () => done(false);
    } catch (e) { resolve(false); }
  });
}

let workerReady = null;
function ensurePdfWorker(status) {
  workerReady = workerReady || (async () => {
    status('首次打开：正在下载 PDF 解析组件（约 1 MB）…');
    const code = await fetchFirst(await sources('/lib/pdf.worker.min.js', WORKER_URLS), 30000)
      .catch((e) => { throw new Error(`PDF 解析组件下载失败（${e.message}）。在设置里启用服务器后会改从你的服务器下载。`); });
    if (await blobWorkerAllowed()) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      return;
    }
    // the page forbids workers: parse on the main thread (pdf.js uses globalThis.pdfjsWorker when present)
    const mod = { exports: {} };
    new Function('module', 'exports', 'define', code)(mod, mod.exports, undefined);
    globalThis.pdfjsWorker = mod.exports;
  })().catch((e) => { workerReady = null; throw e; });
  return workerReady;
}

async function openPdfOverlay(source) {
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
  const status = (msg) => { body.innerHTML = `<div style="color:#fff;text-align:center;padding:40px;line-height:1.6">${ERA.escapeHtml(msg)}</div>`; };
  status('正在加载 PDF…');
  try {
    ensurePdfjs();
    await ensurePdfWorker(status);
    status('正在读取 PDF…');
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
    status(`打开失败：${e.message}（v${ERA.VERSION}）`);
  }
}

function pickLocalPdf() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,.pdf';
  // keep it in the page: some iPadOS Safari versions never fire change on a detached file input
  document.getElementById('era-pdf-input')?.remove();
  inp.id = 'era-pdf-input';
  inp.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(inp);
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) openPdfOverlay(f); };
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
  ['📥 下载离线词典', downloadDictNow],
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
.menu .ver{padding:4px 12px 2px;font-size:11px}
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
      (hasMenuApi ? '<button data-i="hide" class="muted">隐藏此按钮（可在设置中恢复）</button>' : '<button data-i="hide" class="muted">本页暂时隐藏</button>') +
      `<div class="muted ver">英语阅读助手 v${ERA.VERSION}</div>`;
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
