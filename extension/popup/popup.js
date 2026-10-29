(async function () {
  const api = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : chrome;
  const $ = (id) => document.getElementById(id);
  const cfg = await ERA.P.getConfig();
  $('nw').textContent = (await ERA.Store.words()).length;
  $('np').textContent = (await ERA.Store.phrases()).length;
  $('nq').textContent = ((await ERA.P.getData('syncQueue', [])) || []).length;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  $('pdfCur').onclick = () => { api.runtime.sendMessage({ type: 'open-viewer', url: tab && tab.url }); window.close(); };
  $('pdfLocal').onclick = () => { api.runtime.sendMessage({ type: 'open-viewer' }); window.close(); };
  $('book').onclick = () => { api.tabs.create({ url: api.runtime.getURL('options/options.html#words') }); window.close(); };
  $('opt').onclick = () => api.runtime.openOptionsPage();
  $('web').onclick = () => { if (!cfg.server.baseUrl) return ($('msg').textContent = '请先在设置中配置服务器'); api.tabs.create({ url: cfg.server.baseUrl }); };
  $('sync').onclick = async () => {
    $('msg').textContent = '同步中…';
    $('msg').textContent = '同步中…';
    $('msg').textContent = ERA.Store.syncMessage(await ERA.Store.syncAll());
    $('nq').textContent = ((await ERA.P.getData('syncQueue', [])) || []).length;
  };
})();
