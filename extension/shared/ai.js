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

/** Build {url, headers, body} for a profile. Pure function (testable). */
ERA.buildAIRequest = function (profile, messages, opts) {
  const body = { model: profile.model, messages, temperature: profile.temperature ?? 0.2, stream: false };
  if (opts && opts.maxTokens) body.max_tokens = opts.maxTokens;
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

/** Chat with the active AI profile. Needs ERA.P.request and ERA.P.getConfig. */
ERA.aiChat = async function (messages, opts = {}) {
  const cfg = opts.cfg || (await ERA.P.getConfig());
  const profile = opts.profile || ERA.activeAIProfile(cfg);
  if (!profile) throw new Error('未配置 AI，请在设置中添加 AI 接口');
  let content;
  if (profile.type === 'server') {
    const res = await ERA.serverCall('POST', cfg.server.endpoints.aiChat || '/api/ai/chat', { messages, model: profile.model || undefined }, cfg);
    content = res.content;
  } else {
    if (!profile.baseUrl && profile.type !== 'relay') throw new Error('AI 接口地址为空');
    const req = ERA.buildAIRequest(profile, messages, opts);
    const res = await ERA.P.request({ url: req.url, method: 'POST', headers: req.headers, body: JSON.stringify(req.body), timeout: (profile.timeout || 60) * 1000 });
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

ERA.aiConfigured = function (cfg) {
  const p = ERA.activeAIProfile(cfg);
  if (!p) return false;
  if (p.type === 'server') return !!(cfg.server.enabled && cfg.server.baseUrl);
  if (p.type === 'relay') return !!(p.relay && p.relay.url);
  return !!(p.baseUrl && (p.apiKey || /localhost|127\.0\.0\.1/.test(p.baseUrl)));
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
