/* English Reading Assistant — shared config & constants.
 * Shared by the browser extension, the userscript and the web app. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.VERSION = '1.3.0';

ERA.CATEGORIES = ['医学', '时政', '金融', '科学', '工业', '娱乐', '信息技术', '法律', '生物学', '人工智能'];

ERA.GRAMMAR_ROLES = {
  subject: { label: '主语', color: '#2563eb' },
  predicate: { label: '谓语', color: '#dc2626' },
  object: { label: '宾语', color: '#16a34a' },
  attributive: { label: '定语', color: '#9333ea' },
  adverbial: { label: '状语', color: '#d97706' },
  complement: { label: '补语', color: '#0d9488' },
  predicative: { label: '表语', color: '#db2777' },
  appositive: { label: '同位语', color: '#4f46e5' },
  conjunction: { label: '连接词', color: '#64748b' },
  other: { label: '其他', color: '#94a3b8' },
};

ERA.HIGHLIGHT_COLORS = { yellow: '#fde047', green: '#86efac', blue: '#93c5fd', pink: '#f9a8d4', orange: '#fdba74' };

ERA.defaultConfig = function () {
  return {
    version: 1,
    ui: {
      showToolbar: true, // floating toolbar after selecting text
      autoLookupWord: true, // single word -> show dictionary card at once
      autoAnalyzeOnAdd: true, // run AI word analysis when adding to vocab book
      translateSentenceOnAdd: true,
      pdfIntercept: true, // extension: open .pdf links in the study reader
      showBookMarks: true, // wavy / double underline under saved 生词 and 好词好句
      fab: 'auto', // userscript floating menu button: auto (no script menu or touch screen) | on | off
    },
    tts: { lang: 'en-US', voice: '', rate: 0.95 },
    ai: {
      active: 'default',
      profiles: [
        {
          id: 'default',
          name: 'OpenAI 兼容接口',
          // openai: call baseUrl directly; relay: go through a local relay/jump server; server: use the backend's AI
          type: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          temperature: 0.2,
          timeout: 60,
          headers: {},
          relay: {
            url: 'http://127.0.0.1:3000/v1', // local relay endpoint (one-api / new-api / LiteLLM / custom forwarder)
            mode: 'openai', // openai: relay itself speaks the OpenAI API; forward: relay forwards to upstream given in a header
            targetHeader: 'X-Target-URL',
            relayKey: '',
          },
        },
      ],
    },
    server: {
      enabled: false,
      baseUrl: '', // e.g. http://<server-ip>:8080
      apiToken: '',
      autoSync: true,
      endpoints: {
        health: '/api/health',
        words: '/api/words',
        phrases: '/api/phrases',
        aiChat: '/api/ai/chat',
        dict: '/api/dict',
      },
    },
  };
};

ERA.mergeConfig = function (base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = ERA.mergeConfig(base[k], v);
    else out[k] = v;
  }
  return out;
};

ERA.activeAIProfile = function (cfg) {
  const ps = (cfg.ai && cfg.ai.profiles) || [];
  return ps.find((p) => p.id === cfg.ai.active) || ps[0] || null;
};

/** Export the AI + server config as a portable JSON document. */
ERA.exportConfig = function (cfg, { includeSecrets = true } = {}) {
  const c = JSON.parse(JSON.stringify(cfg));
  if (!includeSecrets) {
    for (const p of c.ai.profiles) { p.apiKey = ''; if (p.relay) p.relay.relayKey = ''; }
    c.server.apiToken = '';
  }
  return JSON.stringify({ type: 'era-config', version: 1, exportedAt: new Date().toISOString(), ai: c.ai, server: c.server, tts: c.tts, ui: c.ui }, null, 2);
};

/** Import a config document; accepts a full export, or only { ai } / { server }. */
ERA.importConfig = function (cfg, text) {
  const doc = typeof text === 'string' ? JSON.parse(text) : text;
  if (!doc || (doc.type && doc.type !== 'era-config')) throw new Error('不是有效的配置文件');
  const next = JSON.parse(JSON.stringify(cfg));
  if (doc.ai && Array.isArray(doc.ai.profiles)) {
    const byId = new Map(next.ai.profiles.map((p) => [p.id, p]));
    for (const p of doc.ai.profiles) byId.set(p.id, ERA.mergeConfig(ERA.defaultConfig().ai.profiles[0], p));
    next.ai.profiles = [...byId.values()];
    if (doc.ai.active) next.ai.active = doc.ai.active;
  }
  if (doc.server) next.server = ERA.mergeConfig(next.server, doc.server);
  if (doc.tts) next.tts = ERA.mergeConfig(next.tts, doc.tts);
  if (doc.ui) next.ui = ERA.mergeConfig(next.ui, doc.ui);
  return next;
};

ERA.uid = function () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

ERA.escapeHtml = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
};

ERA.isSingleWord = function (s) {
  return /^[A-Za-z][A-Za-z'’-]{0,40}$/.test(String(s).trim());
};
