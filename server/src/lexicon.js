// Offline dictionary, lemmatisation and AI helpers (prompts shared with the extension).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// The shared browser modules attach to globalThis.ERA
await import(pathToFileURL(path.join(pub, 'shared', 'config.js')).href);
await import(pathToFileURL(path.join(pub, 'shared', 'dict.js')).href);
await import(pathToFileURL(path.join(pub, 'shared', 'ai.js')).href);
export const ERA = globalThis.ERA;

export const dict = JSON.parse(fs.readFileSync(path.join(pub, 'data', 'dict.json'), 'utf8'));
export const roots = JSON.parse(fs.readFileSync(path.join(pub, 'data', 'roots.json'), 'utf8'));
export const CATEGORIES = ERA.CATEGORIES;

export const lookup = (w) => ERA.dictLookup(dict, roots, w);

/** Canonical lemma: different tenses / plurals of one word map to one row. */
export function canonicalLemma(word, hint) {
  const cands = [hint, word].filter(Boolean).map((s) => String(s).toLowerCase().trim().replace(/[’]/g, "'"));
  for (const c of cands) {
    const r = lookup(c);
    if (r && r.found) return r.lemma;
  }
  return cands[0];
}

const KEYWORDS = {
  医学: /\b(patient|clinical|disease|hospital|medic|therap|surg|diagnos|cancer|tumou?r|vaccine|drug|symptom|endoscop|gastro|nurs|health|pandemic|virus)\w*/gi,
  时政: /\b(president|government|election|parliament|congress|minister|policy|diplomat|senate|vote|political|sanction|war|military|treaty|white house|kremlin)\w*/gi,
  金融: /\b(bank|stock|market|investor|inflation|interest rate|bond|currency|financ|econom|gdp|fed|trading|equity|fund|crypto|bitcoin|tariff)\w*/gi,
  科学: /\b(physic|chemi|astronom|quantum|scientist|experiment|laborator|research|planet|particle|climate|geolog|mathemat|telescope)\w*/gi,
  工业: /\b(manufactur|factory|industr|supply chain|steel|automotive|engineering|production|semiconductor|energy|oil|mining|logistics)\w*/gi,
  娱乐: /\b(film|movie|music|celebrit|actor|actress|album|concert|game|hollywood|tv|series|festival|sport|football|olymp)\w*/gi,
  信息技术: /\b(software|internet|cloud|cyber|computer|smartphone|app|database|programming|developer|chip|silicon valley|tech|digital|network|server)\w*/gi,
  法律: /\b(court|judge|law|legal|lawsuit|attorney|statute|regulat|verdict|prosecut|constitution|rights|litigation|copyright)\w*/gi,
  生物学: /\b(gene|genom|cell|protein|species|evolution|organism|dna|rna|enzyme|bacteri|ecolog|neuron|molecular|biolog)\w*/gi,
  人工智能: /\b(artificial intelligence|machine learning|deep learning|neural network|llm|language model|chatgpt|openai|transformer|ai model|generative ai|agent)\w*/gi,
};

export function guessCategory(text) {
  let best = null, bestN = 0;
  for (const [cat, re] of Object.entries(KEYWORDS)) {
    const n = (String(text).match(re) || []).length * (cat === '人工智能' ? 1.5 : 1);
    if (n > bestN) { best = cat; bestN = n; }
  }
  return bestN >= 1 ? best : null;
}

/* ---------- upstream AI (z.ai / any OpenAI-compatible) ---------- */
export class AIClient {
  constructor(getSettings) { this.getSettings = getSettings; }

  get configured() { const s = this.getSettings(); return !!(s.ai_base_url && s.ai_api_key); }

  async chat(messages, { model, json = false, timeout = 150000 } = {}) {
    const s = this.getSettings();
    if (!this.configured) throw new Error('服务器未配置 AI（AI_BASE_URL / AI_API_KEY）');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(s.ai_base_url.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.ai_api_key },
        body: JSON.stringify({ model: model || s.ai_model, messages, temperature: 0.2, stream: false, ...(s.ai_extra ? JSON.parse(s.ai_extra) : {}) }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`上游 AI 错误 ${res.status}: ${text.slice(0, 300)}`);
      const content = JSON.parse(text).choices?.[0]?.message?.content ?? '';
      return json ? ERA.parseJSONLoose(content) : content;
    } finally { clearTimeout(t); }
  }

  /** Pull the model list from the upstream server. */
  async models() {
    const s = this.getSettings();
    const res = await fetch(s.ai_base_url.replace(/\/+$/, '') + '/models', { headers: { Authorization: 'Bearer ' + s.ai_api_key } });
    if (!res.ok) throw new Error(`拉取模型失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data.data || data.models || []).map((m) => m.id || m.name || m).filter(Boolean).sort();
  }

  word(word, sentence) { return this.chat(ERA.PROMPTS.word(word, sentence), { json: true }); }
  async classify(meta, excerpt) {
    const r = await this.chat(ERA.PROMPTS.classify(meta, excerpt), { json: true });
    return CATEGORIES.includes(r.category) ? r.category : null;
  }
}
