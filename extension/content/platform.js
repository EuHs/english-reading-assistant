/* Extension platform adapter — shared by content scripts, the PDF viewer and the options page. */
(function () {
  const api = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : chrome;
  if (globalThis.__ERA_LOADED__) return;
  globalThis.__ERA_LOADED__ = true;

  const P = {
    name: 'extension',
    async getConfig() {
      const { config } = await api.storage.local.get('config');
      return ERA.mergeConfig(ERA.defaultConfig(), config || {});
    },
    async setConfig(c) { await api.storage.local.set({ config: c }); },
    async getData(k, d) { const r = await api.storage.local.get(k); return r[k] === undefined ? d : r[k]; },
    async setData(k, v) { await api.storage.local.set({ [k]: v }); },
    request(opts) { return api.runtime.sendMessage({ type: 'fetch', ...opts }); },
    lookup(word) { return api.runtime.sendMessage({ type: 'lookup', word }); },
    // right-click menu titles follow the selection's 生词/好句 state, like a bookmark star
    menuState(st) { api.runtime.sendMessage({ type: 'menu-state', ...st }).catch(() => {}); },
  };
  ERA.P = P;

  const isViewer = location.href.startsWith(api.runtime.getURL('viewer/'));
  const isExtPage = location.protocol === 'chrome-extension:' || location.protocol === 'safari-web-extension:' || location.protocol === 'moz-extension:';
  if (isExtPage && !isViewer) return; // options/popup only need P

  ERA.init(P, { restore: !isViewer });

  api.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'command') return;
    if (isViewer) {
      // broadcast from background: only the targeted viewer tab reacts
      api.tabs.getCurrent((tab) => { if (!msg.tabId || (tab && tab.id === msg.tabId)) ERA.command(msg.cmd, msg.text); });
    } else ERA.command(msg.cmd, msg.text);
  });
})();
