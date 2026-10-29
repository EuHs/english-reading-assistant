/* AI client (OpenAI-compatible chat completions) + prompts.
 * Prompts are also used by the server (server/src/ai.js requires this file). */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.PROMPTS = {
  translate(text, context) {
    return [
      { role: 'system', content: '你是专业的英汉翻译。只输出 JSON，不要多余文字。' },
      {
        role: 'user',
        content:
          `把下面英文翻译成自然、准确的简体中文。若提供了上下文句子，请结合上下文确定词义，并同时翻译整句。\n` +
          `输出 JSON：{"translation":"选中内容的译文","sentence_translation":"上下文整句译文（无上下文则为空字符串）","notes":"难点说明（可空）"}\n\n` +
          `选中内容：${text}\n上下文句子：${context || ''}`,
      },
    ];
  },
  word(word, sentence) {
    return [
      {
        role: 'system',
        content:
          'You are an expert English lexicographer and etymologist. Analyse word formation strictly according to standard ' +
          'etymology (Oxford English Dictionary, Merriam-Webster, Etymonline): Latin, Greek, Old English, French roots and ' +
          'standard affixes. A word can contain MORE THAN ONE root (e.g. "manuscript" = manu + script, "biography" = bio + graph + -y). ' +
          'Never invent roots; if the word is not decomposable, return an empty morphology list. Output JSON only.',
      },
      {
        role: 'user',
        content:
          `Word: "${word}"\nSentence context: "${sentence || ''}"\n\n` +
          'Return JSON with exactly these keys:\n' +
          '{\n' +
          ' "word": surface form,\n' +
          ' "lemma": dictionary base form (e.g. ran -> run, studies -> study, analyses -> analysis),\n' +
          ' "phonetic": IPA (British or American, no slashes),\n' +
          ' "pos": part of speech in context, e.g. "v." / "n." / "adj.",\n' +
          ' "meaning": 该词在本句中的中文含义,\n' +
          ' "definitions": ["n. 中文释义", "v. 中文释义"],\n' +
          ' "morphology": [{"part":"in-","type":"prefix|root|suffix","meaning":"中文含义 (English gloss)","origin":"Latin|Greek|Old English|French|..."}],\n' +
          ' "roots": ["root keys only, e.g. spect, script — all real roots, can be several"],\n' +
          ' "etymology": "一句中文词源说明",\n' +
          ' "forms": {"base":"","third_person":"","past":"","past_participle":"","present_participle":"","plural":"","comparative":"","superlative":""} (leave non-applicable empty),\n' +
          ' "tenses": [{"name":"一般现在时","form":"runs","example":"She runs every day."}] (verbs only: 一般现在时, 一般过去时, 一般将来时, 现在进行时, 过去进行时, 现在完成时, 过去完成时, 被动语态(若及物); empty for non-verbs),\n' +
          ' "collocations": ["常见搭配 + 中文"],\n' +
          ' "synonyms": ["..."]\n' +
          '}',
      },
    ];
  },
  grammar(sentence) {
    return [
      {
        role: 'system',
        content:
          '你是英语语法专家，擅长句子成分分析（主谓宾定状补表同位语）。只输出 JSON。' +
          'segments 必须按原句顺序完整覆盖整句，所有 text 依次拼接后（忽略空格）应等于原句；不要改写原文。',
      },
      {
        role: 'user',
        content:
          `分析句子：${sentence}\n\n输出 JSON：\n` +
          '{\n' +
          ' "translation": "整句中文翻译",\n' +
          ' "sentence_type": "简单句/并列句/复合句（说明从句类型）",\n' +
          ' "segments": [{"text":"原文片段","role":"subject|predicate|object|attributive|adverbial|complement|predicative|appositive|conjunction|other","note":"简短中文说明，如：定语从句修饰 xxx"}],\n' +
          ' "clauses": [{"text":"从句原文","type":"定语从句/宾语从句/状语从句(时间)/...","function":"在句中作用"}],\n' +
          ' "skeleton": "句子主干（主+谓+宾/表）",\n' +
          ' "explanation": "中文讲解要点（长难句拆分思路、特殊结构如倒装/省略/非谓语）"\n' +
          '}\n' +
          '规则：主句的成分作为顶层 segments；定语/状语从句作为一个整体 segment 标为 attributive/adverbial，并在 clauses 中细分。',
      },
    ];
  },
  classify(meta, excerpt) {
    return [
      { role: 'system', content: '你是文章分类器。只输出 JSON。' },
      {
        role: 'user',
        content:
          `从以下类别中为文章选一个最合适的主类别：${ERA.CATEGORIES.join('、')}。\n` +
          `输出 JSON：{"category":"类别","confidence":0-1}\n\n标题：${meta.title || ''}\n来源：${meta.site || ''}\n摘录：${(excerpt || '').slice(0, 1200)}`,
      },
    ];
  },
};

ERA.parseJSONLoose = function (text) {
  if (!text) throw new Error('AI 返回为空');
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error('AI 返回不是 JSON：' + t.slice(0, 120));
};

/* ---------- request parameters: one generic set, written the way each provider expects ---------- */
(function () {
  const QWEN_BUDGET = { minimal: 256, low: 1024, medium: 4096, high: 16384 };
  const REASONING_KEYS = ['reasoning_effort', 'thinking', 'reasoning', 'enable_thinking', 'thinking_budget'];
  const num = (v) => (v === '' || v == null || isNaN(+v) ? undefined : +v);
  const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

  ERA.REASONING_FORMATS = {
    auto: '自动（按接口地址和模型判断）',
    effort: 'reasoning_effort（OpenAI 标准：OpenAI、Gemini、Groq、xAI、Ollama…）',
    zhipu: 'thinking + reasoning_effort（智谱 GLM：Z.AI / BigModel）',
    thinking: 'thinking 开关（豆包等，只分开 / 关）',
    qwen: 'enable_thinking（通义千问 DashScope、硅基流动）',
    openrouter: 'reasoning 对象（OpenRouter）',
    none: '不发送思考参数',
  };
  ERA.EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']; // lowest first
  ERA.REASONING_KEYS = REASONING_KEYS;

  ERA.detectReasoningFormat = function (baseUrl, model) {
    const u = String(baseUrl || '').toLowerCase(), m = String(model || '').toLowerCase();
    if (/openrouter\.ai/.test(u)) return 'openrouter';
    if (/bigmodel\.cn|\bz\.ai\b/.test(u) || /^glm-/.test(m)) return 'zhipu';
    if (/dashscope|aliyuncs\.com|siliconflow/.test(u) || /^(qwen|qwq)/.test(m)) return 'qwen';
    if (/volces\.com|volcengine/.test(u) || /doubao/.test(m)) return 'thinking';
    return 'effort';
  };

  /** Body fields asking for thinking `level` (off / minimal … max, or any value the provider names) in `format`; '' sends nothing. */
  ERA.reasoningFields = function (format, level) {
    level = String(level || '').trim().toLowerCase();
    if (!level || format === 'none') return {};
    const off = /^(off|none|disabled?|false)$/.test(level);
    switch (format) {
      case 'zhipu': return off ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: level };
      case 'thinking': return { thinking: { type: off ? 'disabled' : 'enabled' } };
      case 'qwen': return off ? { enable_thinking: false } : { enable_thinking: true, ...(QWEN_BUDGET[level] ? { thinking_budget: QWEN_BUDGET[level] } : {}) };
      case 'openrouter': return { reasoning: off ? { enabled: false } : { effort: level } };
      default: return { reasoning_effort: off ? 'none' : level };
    }
  };

  /** The custom-parameters JSON (object or text) merged last into every request. */
  ERA.parseExtra = function (x) {
    if (!x) return {};
    if (typeof x === 'object') return x;
    let o;
    try { o = JSON.parse(x); } catch (e) { throw new Error('自定义参数不是合法 JSON'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('自定义参数应为 JSON 对象，如 {"top_k":40}');
    return o;
  };

  /** Build {url, headers, body} for a profile. Pure function (testable). */
  ERA.buildAIRequest = function (profile, messages, opts) {
    const body = { model: profile.model, messages, stream: false };
    const temperature = num(profile.temperature), topP = num(profile.topP), maxTokens = num((opts && opts.maxTokens) || profile.maxTokens);
    if (temperature !== undefined) body.temperature = temperature;
    if (topP !== undefined) body.top_p = topP;
    if (maxTokens) body.max_tokens = maxTokens;
    const format = !profile.reasoningFormat || profile.reasoningFormat === 'auto' ? ERA.detectReasoningFormat(profile.baseUrl, profile.model) : profile.reasoningFormat;
    Object.assign(body, ERA.reasoningFields(format, profile.reasoning));
    // the provider listed this model's parameters (OpenRouter-style): leave out the sampling ones it doesn't take
    const info = profile.modelInfo;
    if (info && info.id === profile.model && Array.isArray(info.params) && info.params.length) {
      for (const k of ['temperature', 'top_p', 'max_tokens']) if (k in body && !info.params.includes(k)) delete body[k];
    }
    Object.assign(body, ERA.parseExtra(profile.extra));
    const base = String(profile.baseUrl || '').replace(/\/+$/, '');
    let url = base + '/chat/completions';
    const headers = { 'Content-Type': 'application/json', ...(profile.headers || {}) };
    if (profile.apiKey) headers.Authorization = 'Bearer ' + profile.apiKey;
    if (profile.type === 'relay') {
      const r = profile.relay || {};
      const relayBase = String(r.url || '').replace(/\/+$/, '');
      if (r.mode === 'forward') {
        url = relayBase;
        headers[r.targetHeader || 'X-Target-URL'] = base + '/chat/completions';
        if (r.relayKey) headers['X-Relay-Key'] = r.relayKey;
      } else {
        url = relayBase + '/chat/completions';
        if (r.relayKey) headers.Authorization = 'Bearer ' + r.relayKey;
      }
    }
    return { url, headers, body };
  };

  /** {url, headers} listing a profile's models (GET …/models), through its relay when it has one. */
  ERA.buildModelsRequest = function (profile) {
    const base = String(profile.baseUrl || '').replace(/\/+$/, '');
    let url = base + '/models';
    const headers = { ...(profile.headers || {}) };
    if (profile.apiKey) headers.Authorization = 'Bearer ' + profile.apiKey;
    if (profile.type === 'relay') {
      const r = profile.relay || {};
      if (r.mode === 'forward') {
        headers[r.targetHeader || 'X-Target-URL'] = url;
        url = String(r.url || '').replace(/\/+$/, '');
        if (r.relayKey) headers['X-Relay-Key'] = r.relayKey;
      } else {
        url = String(r.url || '').replace(/\/+$/, '') + '/models';
        if (r.relayKey) headers.Authorization = 'Bearer ' + r.relayKey;
      }
    }
    return { url, headers };
  };

  /** A direct or relay profile has what it needs to send requests. */
  ERA.profileReady = (p) => (p.type === 'relay' ? !!(p.relay && p.relay.url) : !!(p.baseUrl && (p.apiKey || /localhost|127\.0\.0\.1/.test(p.baseUrl))));

  /* Providers disagree on parameters, and most only say so in a 400 error ("This model always engages in
   * thinking and cannot be disabled; please use low, high, or max"). Adapt the request to that error and retry. */
  // thinking switched off wins over a level sent alongside it (e.g. custom JSON disabling what the level enables)
  const effortOf = (b) => ((b.thinking && b.thinking.type === 'disabled') || b.enable_thinking === false || (b.reasoning && b.reasoning.enabled === false) ? 'none'
    : b.reasoning_effort || (b.reasoning && b.reasoning.effort) || '');
  const withEffort = (b, level) => {
    const n = { ...b };
    if (n.reasoning && typeof n.reasoning === 'object') n.reasoning = { effort: level };
    else {
      n.reasoning_effort = level;
      if (n.thinking) n.thinking = { ...n.thinking, type: 'enabled' };
      if ('enable_thinking' in n) n.enable_thinking = true;
    }
    return n;
  };
  const rank = (e) => ERA.EFFORTS.indexOf(e);

  /** Thinking levels a provider's error names, minus the one that was sent; lowest first. */
  ERA.allowedEfforts = function (message, sent) {
    const words = String(message).toLowerCase().match(/[a-z]+/g) || [];
    return [...new Set(words.filter((w) => rank(w) >= 0 && w !== sent))].sort((a, b) => rank(a) - rank(b));
  };

  /** A changed request body for a 400 that names a parameter, as { body, fix, text }; null when it names none. */
  ERA.adaptToError = function (body, errText) {
    const msg = String(errText || ''), low = msg.toLowerCase();
    const sent = Object.keys(body).filter((k) => !['model', 'messages', 'stream'].includes(k));
    const reasoning = sent.filter((k) => REASONING_KEYS.includes(k));
    if (reasoning.length && /think|reason|effort/.test(low)) {
      const cur = effortOf(body);
      const allowed = ERA.allowedEfforts(msg, cur);
      if (allowed.length) {
        const want = rank(cur || 'medium');
        const level = allowed.reduce((best, a) => (Math.abs(rank(a) - want) < Math.abs(rank(best) - want) ? a : best));
        return { body: withEffort(body, level), fix: { effort: level }, text: `模型只接受思考强度 ${allowed.join(' / ')}，已改用 ${level}` };
      }
      return { body: omit(body, reasoning), fix: { drop: reasoning }, text: '模型不接受这个思考参数，已去掉（用模型默认）' };
    }
    const named = sent.filter((k) => low.includes(k.toLowerCase()));
    if (named.length) return { body: omit(body, named), fix: { drop: named }, text: `模型不支持参数 ${named.join('、')}，已去掉` };
    return null;
  };

  const learned = new Map(); // request settings -> the fix that made the provider accept them
  const applyFix = (b, fix) => {
    const n = fix.drop && fix.drop.length ? omit(b, fix.drop) : b;
    return fix.effort ? withEffort(n, fix.effort) : n;
  };
  /** POST `body` with `send(body) -> {ok, status, text}`, adapting to at most two 400s; a fix is remembered
   * for the same settings so later calls don't fail first (`fresh` ignores it: a settings test should show
   * what the provider requires). Returns { res, notes: [{ text, fix }] }. */
  ERA.aiSend = async function (send, body, { fresh = false } = {}) {
    const key = JSON.stringify(omit(body, ['messages']));
    if (!fresh && learned.has(key)) body = applyFix(body, learned.get(key));
    const notes = [];
    for (let i = 0; ; i++) {
      const res = await send(body);
      if (res.ok || res.status !== 400 || i === 2) return { res, notes };
      const a = ERA.adaptToError(body, res.text);
      if (!a) return { res, notes };
      body = a.body;
      notes.push({ text: a.text, fix: a.fix });
      const prev = learned.get(key) || {};
      learned.set(key, { drop: [...new Set([...(prev.drop || []), ...(a.fix.drop || [])])], effort: a.fix.effort || prev.effort });
    }
  };

  /* ---------- what a provider's /models says about each model (OpenRouter lists parameters; most list ids only) ---------- */
  ERA.modelMeta = function (m) {
    if (!m || typeof m !== 'object') return null;
    const r = m.reasoning && typeof m.reasoning === 'object' ? m.reasoning : {};
    const tp = m.top_provider || {};
    const defaults = m.default_parameters && typeof m.default_parameters === 'object'
      ? Object.fromEntries(Object.entries(m.default_parameters).filter(([, v]) => v != null)) : null;
    const meta = {
      id: m.id || m.name,
      params: Array.isArray(m.supported_parameters) ? m.supported_parameters : null,
      efforts: Array.isArray(r.supported_efforts) ? r.supported_efforts.slice().sort((a, b) => rank(a) - rank(b)) : null,
      defaultEffort: r.default_effort || null,
      mandatory: typeof r.mandatory === 'boolean' ? r.mandatory : null,
      defaults: defaults && Object.keys(defaults).length ? defaults : null,
      maxOutput: tp.max_completion_tokens || m.max_completion_tokens || m.max_output_tokens || m.outputTokenLimit || null,
      context: m.context_length || tp.context_length || m.max_model_len || m.inputTokenLimit || null,
      capabilities: Array.isArray(m.capabilities) ? m.capabilities : null,
    };
    return Object.entries(meta).some(([k, v]) => k !== 'id' && v != null) ? meta : null;
  };
  ERA.describeModel = function (meta) {
    if (!meta) return '';
    const parts = [];
    if (meta.efforts || meta.mandatory != null) {
      parts.push('思考' + (meta.mandatory ? '必须开启' : '可以关闭') + (meta.efforts ? '，强度可选 ' + meta.efforts.join(' / ') : '') + (meta.defaultEffort ? '（默认 ' + meta.defaultEffort + '）' : ''));
    }
    if (meta.defaults) parts.push('默认 ' + Object.entries(meta.defaults).map(([k, v]) => k + '=' + v).join('，'));
    if (meta.maxOutput) parts.push('最大输出 ' + meta.maxOutput + ' tokens');
    if (meta.context) parts.push('上下文 ' + meta.context);
    if (meta.capabilities) parts.push('能力 ' + meta.capabilities.join('、'));
    if (meta.params) parts.push('支持参数 ' + meta.params.join('、'));
    return '供应商提供：' + parts.join('；');
  };
  /** { ids, info } from a /models response; info only for models that come with parameter information. */
  ERA.parseModelList = function (data) {
    const list = Array.isArray(data) ? data : (data && (data.data || data.models)) || [];
    const ids = [], info = {};
    for (const m of list) {
      const id = typeof m === 'string' ? m : m && (m.id || m.name);
      if (!id) continue;
      ids.push(id);
      const meta = typeof m === 'object' ? ERA.modelMeta(m) : null;
      if (meta) info[id] = meta;
    }
    return { ids: ids.sort(), info };
  };
})();

/** Toast what the provider made us change (the settings page shows it instead). */
ERA.aiNotify = function (notes) {
  if (ERA.UI && ERA.UI.toast) ERA.UI.toast('AI 参数已按模型要求自动调整：' + notes.map((n) => n.text).join('；') + '（可在设置里改）', 6000);
};

/** Chat with the active AI profile. Needs ERA.P.request and ERA.P.getConfig. */
ERA.aiChat = async function (messages, opts = {}) {
  const cfg = opts.cfg || (await ERA.P.getConfig());
  const profile = opts.profile || ERA.activeAIProfile(cfg);
  if (!profile) throw new Error('未配置 AI，请在设置中添加 AI 接口');
  let content;
  if (profile.type === 'server') {
    const res = await ERA.serverCall('POST', cfg.server.endpoints.aiChat || '/api/ai/chat', { messages, model: profile.model || undefined, fresh: !!opts.fresh }, cfg);
    content = res.content;
    if (res.notes && res.notes.length) (opts.onNotes || ERA.aiNotify)(res.notes);
  } else {
    if (!profile.baseUrl && profile.type !== 'relay') throw new Error('AI 接口地址为空');
    const req = ERA.buildAIRequest(profile, messages, opts);
    const send = (body) => ERA.P.request({ url: req.url, method: 'POST', headers: req.headers, body: JSON.stringify(body), timeout: (profile.timeout || 60) * 1000 });
    const { res, notes } = await ERA.aiSend(send, req.body, { fresh: !!opts.fresh });
    if (notes.length) (opts.onNotes || ERA.aiNotify)(notes);
    if (!res.ok) throw new Error(`AI 接口错误 ${res.status}: ${String(res.text).slice(0, 200)}`);
    const data = JSON.parse(res.text);
    content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  }
  return opts.json ? ERA.parseJSONLoose(content) : content;
};

ERA.aiTranslate = (text, context) => ERA.aiChat(ERA.PROMPTS.translate(text, context), { json: true });
ERA.aiWord = (word, sentence) => ERA.aiChat(ERA.PROMPTS.word(word, sentence), { json: true });
ERA.aiGrammar = (sentence) => ERA.aiChat(ERA.PROMPTS.grammar(sentence), { json: true });
ERA.aiClassify = async (meta, excerpt) => {
  const r = await ERA.aiChat(ERA.PROMPTS.classify(meta, excerpt), { json: true });
  return ERA.CATEGORIES.includes(r.category) ? r.category : null;
};

/** AI is set up and allowed to run without a click (设置 → AI 功能：自动). */
ERA.aiAuto = (cfg) => ERA.aiConfigured(cfg) && cfg.ui.aiMode !== 'manual';

ERA.aiConfigured = function (cfg) {
  const p = ERA.activeAIProfile(cfg);
  if (!p) return false;
  if (p.type === 'server') return !!(cfg.server.enabled && cfg.server.baseUrl);
  return ERA.profileReady(p);
};

/* ---------- Server client ---------- */
ERA.serverCall = async function (method, path, body, cfgIn, timeout = 90000) {
  const cfg = cfgIn || (await ERA.P.getConfig());
  const s = cfg.server;
  if (!s || !s.baseUrl) throw new Error('未配置服务器');
  const headers = { 'Content-Type': 'application/json' };
  if (s.apiToken) headers.Authorization = 'Bearer ' + s.apiToken;
  const res = await ERA.P.request({ url: s.baseUrl.replace(/\/+$/, '') + path, method, headers, body: body ? JSON.stringify(body) : undefined, timeout });
  let data = null;
  try { data = res.text ? JSON.parse(res.text) : null; } catch (e) { /* non-json */ }
  if (!res.ok) throw new Error((data && data.error) || `服务器错误 ${res.status}`);
  return data;
};
