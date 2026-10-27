/* Settings form: AI profiles (direct / local relay / via server), server, TTS, import & export.
 * Rendered in the extension options page and in the userscript's in-page panel. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.Settings = {
  async render(container) {
    const esc = ERA.escapeHtml;
    let cfg = await ERA.P.getConfig();
    const voices = (globalThis.speechSynthesis && speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang))) || [];
    const p = ERA.activeAIProfile(cfg) || ERA.defaultConfig().ai.profiles[0];
    const r = p.relay || {};
    const s = cfg.server;
    const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label || v)}</option>`;
    container.innerHTML = `
    <div class="era-settings">
      <div class="sec"><h4>AI 接口</h4>
        <div class="row"><label>当前配置</label><select name="profile">${cfg.ai.profiles.map((x) => opt(x.id, cfg.ai.active, x.name)).join('')}</select>
          <button class="btn gh" data-x="add">新增</button><button class="btn gh" data-x="del">删除</button></div>
        <div class="row"><label>名称</label><input type="text" name="name" value="${esc(p.name)}"></div>
        <div class="row"><label>类型</label><select name="type">
          ${opt('openai', p.type, '直连 OpenAI 兼容接口（OpenAI / DeepSeek / 智谱 / 通义 / Ollama …）')}
          ${opt('relay', p.type, '本机 API 跳板（one-api / new-api / LiteLLM / 自建转发）')}
          ${opt('server', p.type, '使用服务器端 AI（密钥保存在服务器）')}</select></div>
        <div class="row" data-show="openai relay"><label>上游 Base URL</label><input type="text" name="baseUrl" value="${esc(p.baseUrl)}" placeholder="https://api.openai.com/v1"></div>
        <div class="row" data-show="openai relay"><label>API Key</label><input type="password" name="apiKey" value="${esc(p.apiKey)}" autocomplete="off"></div>
        <div class="row"><label>模型</label><input type="text" name="model" value="${esc(p.model)}" list="era-models"><datalist id="era-models"></datalist><button class="btn gh" data-x="models">拉取模型</button></div>
        <div class="row"><label>温度 / 超时(秒)</label><input type="text" name="temperature" value="${esc(p.temperature)}" style="width:80px"><input type="text" name="timeout" value="${esc(p.timeout)}" style="width:80px"></div>
        <div class="row" data-show="openai relay"><label>附加请求头 JSON</label><textarea name="headers" rows="2">${esc(JSON.stringify(p.headers || {}))}</textarea></div>
        <fieldset data-show="relay"><legend>跳板设置</legend>
          <div class="row"><label>跳板地址</label><input type="text" name="relay.url" value="${esc(r.url || '')}" placeholder="http://127.0.0.1:3000/v1"></div>
          <div class="row"><label>跳板模式</label><select name="relay.mode">
            ${opt('openai', r.mode, 'OpenAI 兼容：跳板自身提供 /chat/completions')}
            ${opt('forward', r.mode, '转发：POST 到跳板，上游地址放在请求头')}</select></div>
          <div class="row"><label>上游地址请求头</label><input type="text" name="relay.targetHeader" value="${esc(r.targetHeader || 'X-Target-URL')}"></div>
          <div class="row"><label>跳板密钥</label><input type="password" name="relay.relayKey" value="${esc(r.relayKey || '')}" placeholder="可空，OpenAI 兼容模式下替代 API Key"></div>
        </fieldset>
        <div class="btns"><button class="btn gh" data-x="testai">测试 AI</button><span class="muted" data-out="ai"></span></div>
      </div>

      <div class="sec"><h4>服务器（生词同步 / 网页端）</h4>
        <div class="row"><label><input type="checkbox" name="s.enabled" ${s.enabled ? 'checked' : ''}> 启用服务器</label><label><input type="checkbox" name="s.autoSync" ${s.autoSync ? 'checked' : ''}> 添加后自动同步</label></div>
        <div class="row"><label>服务器地址</label><input type="text" name="s.baseUrl" value="${esc(s.baseUrl)}" placeholder="http://<服务器IP>:8080"></div>
        <div class="row"><label>API Token</label><input type="password" name="s.apiToken" value="${esc(s.apiToken)}" autocomplete="off"></div>
        <details><summary class="muted">接口路径</summary>
          ${Object.entries(s.endpoints).map(([k, v]) => `<div class="row"><label>${k}</label><input type="text" name="ep.${k}" value="${esc(v)}"></div>`).join('')}
        </details>
        <div class="btns"><button class="btn gh" data-x="testsrv">测试连接</button><button class="btn gh" data-x="sync">立即同步</button><span class="muted" data-out="srv"></span></div>
      </div>

      <div class="sec"><h4>朗读与界面</h4>
        <div class="row"><label>语音</label><select name="tts.voice"><option value="">自动</option>${voices.map((v) => opt(v.name, cfg.tts.voice, v.name + ' (' + v.lang + ')')).join('')}</select><button class="btn gh" data-x="tts">试听</button></div>
        <div class="row"><label>语速</label><input type="text" name="tts.rate" value="${esc(cfg.tts.rate)}" style="width:80px"></div>
        ${Object.entries({ showToolbar: '选中文本后显示工具条', autoLookupWord: '选中单词自动查词（桌面端）', autoAnalyzeOnAdd: '加入生词本时自动 AI 分析词根/时态', translateSentenceOnAdd: '加入时自动翻译所属语句', pdfIntercept: '自动用学习阅读器打开 PDF（扩展）', showBookMarks: '在原文显示生词 / 好词好句标记' })
          .map(([k, l]) => `<div class="row"><label><input type="checkbox" name="ui.${k}" ${cfg.ui[k] ? 'checked' : ''}> ${l}</label></div>`).join('')}
      </div>

      <div class="sec"><h4>导入 / 导出（AI 接口与服务器配置）</h4>
        <div class="btns"><button class="btn gh" data-x="export">导出（含密钥）</button><button class="btn gh" data-x="export-safe">导出（不含密钥）</button><button class="btn gh" data-x="import">导入文件</button><input type="file" accept=".json,application/json" hidden></div>
        <textarea name="importText" rows="3" placeholder="也可以把配置 JSON 粘贴到这里后点“导入文本”"></textarea>
        <div class="btns"><button class="btn gh" data-x="import-text">导入文本</button></div>
      </div>
      <div class="btns" style="position:sticky;bottom:0;padding:8px 0;background:inherit"><button class="btn" data-x="save">保存设置</button><span class="muted" data-out="save"></span></div>
    </div>`;

    const $ = (sel) => container.querySelector(sel);
    const val = (n) => { const el = container.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : undefined; };
    const out = (k, msg, err) => { const el = $(`[data-out="${k}"]`); el.textContent = msg; el.style.color = err ? '#dc2626' : ''; };
    const showType = () => container.querySelectorAll('[data-show]').forEach((el) => (el.style.display = el.dataset.show.split(' ').includes(val('type')) ? '' : 'none'));
    showType();
    $('[name=type]').onchange = showType;

    const collect = () => {
      const next = JSON.parse(JSON.stringify(cfg));
      const prof = next.ai.profiles.find((x) => x.id === next.ai.active) || next.ai.profiles[0];
      let headers = {};
      try { headers = JSON.parse(val('headers') || '{}'); } catch (e) { throw new Error('附加请求头不是合法 JSON'); }
      Object.assign(prof, {
        name: val('name') || '未命名', type: val('type'), baseUrl: val('baseUrl') || '', apiKey: val('apiKey') || '', model: val('model'),
        temperature: +val('temperature') || 0.2, timeout: +val('timeout') || 60, headers,
        relay: { url: val('relay.url'), mode: val('relay.mode'), targetHeader: val('relay.targetHeader') || 'X-Target-URL', relayKey: val('relay.relayKey') },
      });
      next.server = { ...next.server, enabled: val('s.enabled'), autoSync: val('s.autoSync'), baseUrl: val('s.baseUrl').replace(/\/+$/, ''), apiToken: val('s.apiToken') };
      for (const k of Object.keys(next.server.endpoints)) next.server.endpoints[k] = val('ep.' + k) || next.server.endpoints[k];
      next.tts = { ...next.tts, voice: val('tts.voice'), rate: +val('tts.rate') || 0.95 };
      for (const k of Object.keys(next.ui)) if (val('ui.' + k) !== undefined) next.ui[k] = val('ui.' + k);
      return next;
    };
    const save = async (next, msg) => { await ERA.P.setConfig(next); cfg = next; out('save', msg || '已保存 ✓'); };

    $('[name=profile]').onchange = async (e) => { const next = collect(); next.ai.active = e.target.value; await save(next); this.render(container); };
    container.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-x]');
      if (!x) return;
      e.preventDefault();
      try {
        switch (x.dataset.x) {
          case 'save': return await save(collect());
          case 'add': {
            const next = collect();
            const np = { ...ERA.defaultConfig().ai.profiles[0], id: ERA.uid(), name: '新配置 ' + (next.ai.profiles.length + 1) };
            next.ai.profiles.push(np); next.ai.active = np.id;
            await save(next); return this.render(container);
          }
          case 'del': {
            const next = collect();
            if (next.ai.profiles.length <= 1) return out('ai', '至少保留一个配置', true);
            next.ai.profiles = next.ai.profiles.filter((x) => x.id !== next.ai.active);
            next.ai.active = next.ai.profiles[0].id;
            await save(next); return this.render(container);
          }
          case 'models': {
            const next = collect();
            out('ai', '拉取中…');
            const models = await ERA.Settings.fetchModels(next);
            $('#era-models').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
            return out('ai', `共 ${models.length} 个模型，点击模型输入框选择`);
          }
          case 'testai': {
            const next = collect();
            out('ai', '测试中…');
            const t0 = Date.now();
            const reply = await ERA.aiChat([{ role: 'user', content: 'Reply with the single word: OK' }], { cfg: next });
            return out('ai', `✓ ${String(reply).slice(0, 40)}（${Date.now() - t0}ms）`);
          }
          case 'testsrv': {
            const next = collect();
            out('srv', '连接中…');
            const h = await ERA.serverCall('GET', next.server.endpoints.health, null, next);
            return out('srv', `✓ ${h.name || 'server'} v${h.version || ''} · 生词 ${h.words ?? '-'} · AI ${h.ai ? '可用' : '未配置'}`);
          }
          case 'sync': { await save(collect()); const r = await ERA.Store.flush(); return out('srv', r.synced ? `✓ 已同步 ${r.ok} 条` : `待同步 ${r.pending} 条：${r.error || r.reason}`, !r.synced); }
          case 'tts': { await save(collect()); return ERA.speak('This is a sample of the selected voice.'); }
          case 'export': return ERA.download('era-config.json', ERA.exportConfig(collect(), { includeSecrets: true }), 'application/json');
          case 'export-safe': return ERA.download('era-config-public.json', ERA.exportConfig(collect(), { includeSecrets: false }), 'application/json');
          case 'import': return $('input[type=file]').click();
          case 'import-text': { await save(ERA.importConfig(collect(), val('importText')), '已导入 ✓'); return this.render(container); }
        }
      } catch (err) { out(x.dataset.x === 'testsrv' || x.dataset.x === 'sync' ? 'srv' : x.dataset.x.startsWith('import') || x.dataset.x === 'save' ? 'save' : 'ai', '✗ ' + err.message, true); }
    });
    $('input[type=file]').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { await save(ERA.importConfig(collect(), await f.text()), '已导入 ✓'); this.render(container); } catch (err) { out('save', '✗ ' + err.message, true); }
    };
  },

  async fetchModels(cfg) {
    const p = ERA.activeAIProfile(cfg);
    if (p.type === 'server') return ((await ERA.serverCall('GET', '/api/ai/models', null, cfg)).models || []);
    const base = String(p.baseUrl || '').replace(/\/+$/, '');
    let url = base + '/models';
    const headers = { ...(p.headers || {}) };
    if (p.apiKey) headers.Authorization = 'Bearer ' + p.apiKey;
    if (p.type === 'relay') {
      const r = p.relay || {};
      if (r.mode === 'forward') { headers[r.targetHeader || 'X-Target-URL'] = url; url = r.url; if (r.relayKey) headers['X-Relay-Key'] = r.relayKey; }
      else { url = String(r.url).replace(/\/+$/, '') + '/models'; if (r.relayKey) headers.Authorization = 'Bearer ' + r.relayKey; }
    }
    const res = await ERA.P.request({ url, method: 'GET', headers, timeout: 20000 });
    if (!res.ok) throw new Error(`拉取失败 ${res.status}: ${String(res.text).slice(0, 120)}`);
    const data = JSON.parse(res.text);
    return (data.data || data.models || []).map((m) => m.id || m.name || m).filter(Boolean).sort();
  },

  /** In-page panel (userscript). */
  openPanel() {
    const UI = ERA.UI;
    const card = UI.card('设置 · 英语阅读助手', '<div class="settings-host"></div>', { fixed: true, cls: 'gpanel' });
    this.render(card.querySelector('.settings-host'));
  },
};

ERA.SETTINGS_CSS = `
.era-settings .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0}
.era-settings .row>label:first-child{min-width:110px;color:var(--muted,#6b7280);font-size:13px}
.era-settings .row input[type=text],.era-settings .row input[type=password],.era-settings .row select{flex:1;min-width:160px}
.era-settings select,.era-settings input[type=password]{border:1px solid var(--line,#e5e7eb);border-radius:6px;padding:5px 8px;font:inherit;background:var(--bg,#fff);color:var(--fg,#111)}
.era-settings fieldset{border:1px dashed var(--line,#e5e7eb);border-radius:8px;margin:8px 0}
.era-settings textarea{min-height:auto}`;
ERA.UI_CSS += ERA.SETTINGS_CSS;
