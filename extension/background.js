/* Background service worker: context menus, cross-origin fetch, offline dictionary, PDF interception. */
importScripts('shared/config.js', 'shared/dict.js');

const api = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : chrome;
const VIEWER = api.runtime.getURL('viewer/viewer.html');

const MENUS = [
  ['translate', '翻译 / 查词「%s」'],
  ['vocab', '☆ 加入生词本'],
  ['phrase', '☆ 加入好词好句'],
  ['grammar', '语法分析（主谓宾定状补）'],
  ['sep1', null],
  ['hl', '高亮'],
  ['ul', '下划线'],
  ['note', '添加批注'],
  ['speak', '朗读'],
];

function createMenus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: 'era', title: '英语阅读助手', contexts: ['selection'] });
    for (const [id, title] of MENUS) {
      if (!title) api.contextMenus.create({ id: 'era-' + id, parentId: 'era', type: 'separator', contexts: ['selection'] });
      else api.contextMenus.create({ id: 'era-' + id, parentId: 'era', title, contexts: ['selection'] });
    }
    api.contextMenus.create({ id: 'era-open-pdf-link', title: '用学习阅读器打开此 PDF 链接', contexts: ['link'] });
    api.contextMenus.create({ id: 'era-open-pdf-page', title: '用学习阅读器打开当前 PDF', contexts: ['page'] });
    api.contextMenus.create({ id: 'era-book', title: '我的生词本', contexts: ['page'] });
  });
}
api.runtime.onInstalled.addListener(createMenus);
api.runtime.onStartup && api.runtime.onStartup.addListener(createMenus);

const openInViewer = (tabId, url) => api.tabs.update(tabId, { url: VIEWER + '?file=' + encodeURIComponent(url) });

async function sendCommand(tab, frameId, cmd, text) {
  if (tab.url && tab.url.startsWith(VIEWER)) {
    return api.runtime.sendMessage({ type: 'command', cmd, text, tabId: tab.id }).catch(() => {});
  }
  const msg = { type: 'command', cmd, text };
  try {
    await api.tabs.sendMessage(tab.id, msg, { frameId: frameId || 0 });
  } catch (e) {
    // Page was open before the extension was installed/updated: inject, then retry
    const manifest = api.runtime.getManifest();
    await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId || 0] }, files: manifest.content_scripts[0].js });
    await api.tabs.sendMessage(tab.id, msg, { frameId: frameId || 0 });
  }
}

api.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId).replace(/^era-/, '');
  if (id === 'open-pdf-link') return openInViewer(tab.id, info.linkUrl);
  if (id === 'open-pdf-page') return openInViewer(tab.id, info.frameUrl || info.pageUrl);
  sendCommand(tab, info.frameId, id, info.selectionText || '').catch((e) => console.warn('[ERA]', e));
});

/* ---------- offline dictionary (loaded lazily, kept while the worker lives) ---------- */
let dictP = null;
function loadDict() {
  dictP = dictP || Promise.all([
    fetch(api.runtime.getURL('data/dict.json')).then((r) => r.json()),
    fetch(api.runtime.getURL('data/roots.json')).then((r) => r.json()),
  ]);
  return dictP;
}

/* ---------- messages ---------- */
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), msg.timeout || 60000);
    fetch(msg.url, { method: msg.method || 'GET', headers: msg.headers || {}, body: msg.body, signal: ctrl.signal })
      .then(async (r) => sendResponse({ ok: r.ok, status: r.status, text: await r.text() }))
      .catch((e) => sendResponse({ ok: false, status: 0, text: e.name === 'AbortError' ? '请求超时' : '网络错误：' + e.message }))
      .finally(() => clearTimeout(timer));
    return true;
  }
  if (msg.type === 'lookup') {
    loadDict().then(([dict, roots]) => sendResponse(ERA.dictLookup(dict, roots, msg.word))).catch((e) => sendResponse(null));
    return true;
  }
  if (msg.type === 'menu-state') {
    const V = { none: '☆ 加入生词本', other: '☆ 加入生词本（已收录，追加本句）', here: '★ 已在生词本 — 点击取消' };
    const P = { none: '☆ 加入好词好句', other: '☆ 加入好词好句（已收录，追加本处）', here: '★ 已在好词好句 — 点击取消' };
    const upd = (id, props) => { try { api.contextMenus.update(id, props, () => void api.runtime.lastError); } catch (e) { /* older Safari */ } };
    upd('era-vocab', { title: V[msg.vocab] || V.none, visible: !!msg.single });
    upd('era-phrase', { title: P[msg.phrase] || P.none });
    return false;
  }
  if (msg.type === 'open-viewer') {
    api.tabs.create({ url: VIEWER + (msg.url ? '?file=' + encodeURIComponent(msg.url) : '') });
  }
  if (msg.type === 'command-active') {
    api.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && sendCommand(tab, 0, msg.cmd, ''));
  }
  return false;
});

/* ---------- open .pdf URLs in the study reader ---------- */
const isPdfUrl = (u) => /^(https?|file):/i.test(u) && /\.pdf(?:$|[?#])/i.test(u);
api.webNavigation.onBeforeNavigate.addListener(async (d) => {
  if (d.frameId !== 0 || !isPdfUrl(d.url) || d.url.startsWith(VIEWER)) return;
  const { config } = await api.storage.local.get('config');
  const enabled = !config || !config.ui || config.ui.pdfIntercept !== false;
  if (enabled) openInViewer(d.tabId, d.url);
});
