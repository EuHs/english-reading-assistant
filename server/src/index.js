// English Reading Assistant — server entry: REST API + web app.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';
import { Service } from './service.js';
import { AIClient, lookup, CATEGORIES } from './lexicon.js';
import { TTS, VOICES } from './tts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env */ }

const env = process.env;
const PORT = +env.PORT || 8080;
const DATA = path.resolve(ROOT, env.DATA_DIR || 'data');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const db = openDb(path.join(DATA, 'era.db'));

/* ---------- settings: env defaults, overridable from the web app (stored in DB) ---------- */
const AI_KEYS = ['ai_base_url', 'ai_api_key', 'ai_model', 'ai_extra'];
function settings() {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return {
    ai_base_url: rows.ai_base_url ?? env.AI_BASE_URL ?? '',
    ai_api_key: rows.ai_api_key ?? env.AI_API_KEY ?? '',
    ai_model: rows.ai_model ?? env.AI_MODEL ?? 'glm-4.6',
    ai_extra: rows.ai_extra ?? env.AI_EXTRA ?? '',
    tts_voice: rows.tts_voice ?? env.TTS_VOICE ?? 'af_heart',
  };
}
const saveSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
const mask = (k) => (k ? k.slice(0, 4) + '****' + k.slice(-4) : '');

const ai = new AIClient(settings);
const svc = new Service(db, ai);
const tts = new TTS({ dataDir: DATA, enabled: env.ENABLE_TTS !== '0', dtype: env.KOKORO_DTYPE, hfEndpoint: env.HF_ENDPOINT });

if (!env.API_TOKEN) console.warn('⚠️  API_TOKEN 未设置：API 对所有人开放。请在 .env 中设置 API_TOKEN。');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));

// CORS: the extension/userscript call from any origin; access is guarded by the token
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const tokenOk = (t) => {
  if (!env.API_TOKEN) return true;
  if (!t) return false;
  const a = Buffer.from(String(t)), b = Buffer.from(env.API_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
function auth(req, res, next) {
  const h = req.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : req.get('x-api-key') || req.query.token;
  if (tokenOk(t)) return next();
  res.status(401).json({ error: '未授权：请提供正确的 API Token' });
}
const wrap = (fn) => async (req, res) => {
  try { const r = await fn(req, res); if (r !== undefined && !res.headersSent) res.json(r); }
  catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ error: e.message }); if (!e.status) console.error(e); }
};

/* ---------- public ---------- */
app.get('/api/health', (req, res) => {
  const authed = tokenOk((req.get('authorization') || '').replace(/^Bearer /, '') || req.get('x-api-key'));
  res.json({ ok: true, name: 'english-reading-assistant', version: VERSION, ai: ai.configured, tts: tts.status(), authRequired: !!env.API_TOKEN, authed, ...(authed ? { words: db.prepare('SELECT COUNT(*) n FROM words').get().n } : {}) });
});

const api = express.Router();
api.use(auth);

/* words */
api.post('/words', wrap((req) => svc.addWord(req.body)));
api.post('/words/batch', wrap((req) => (req.body.items || []).map((p) => { try { return svc.addWord(p); } catch (e) { return { error: e.message }; } })));
api.get('/words', wrap((req) => svc.listWords(req.query)));
api.get('/words/:id', wrap((req, res) => svc.getWord(req.params.id) || res.status(404).json({ error: '不存在' })));
api.patch('/words/:id', wrap((req) => svc.updateWord(req.params.id, req.body)));
api.delete('/words', wrap((req) => svc.removeWordBy(req.query)));
api.delete('/words/:id', wrap((req) => ({ deleted: svc.deleteWord(req.params.id) })));
api.post('/words/:id/enrich', wrap(async (req) => {
  const w = svc.getWord(req.params.id);
  if (!w) throw Object.assign(new Error('不存在'), { status: 404 });
  await svc.enrich(w.id, w.lemma, (w.occurrences[0] || {}).sentence || '');
  return svc.getWord(w.id);
}));

/* phrases */
api.post('/phrases', wrap((req) => svc.addPhrase(req.body)));
api.get('/phrases', wrap((req) => svc.listPhrases(req.query)));
api.delete('/phrases', wrap((req) => svc.removePhraseBy(req.query)));
api.delete('/phrases/:id', wrap((req) => ({ deleted: svc.deletePhrase(req.params.id) })));

/* bookmark-style state of words / phrases on a page */
api.post('/book/status', wrap((req) => svc.bookStatus(req.body || {})));

/* taxonomy */
api.get('/categories', wrap(() => svc.categories()));
api.get('/roots', wrap((req) => svc.listRoots(req.query)));
api.get('/articles', wrap(() => svc.listArticles()));
api.patch('/articles/:id', wrap((req) => { svc.setArticleCategory(req.params.id, req.body.category); return { ok: true }; }));
api.get('/dict/:word', wrap((req, res) => lookup(req.params.word) || res.status(404).json({ error: '未收录' })));

/* quiz */
api.post('/quiz', wrap((req) => svc.startQuiz(req.body)));
api.get('/quiz', wrap(() => svc.listQuizzes()));
api.get('/quiz/:id', wrap((req, res) => svc.getQuiz(req.params.id) || res.status(404).json({ error: '不存在' })));
api.post('/quiz/:id/answer', wrap((req) => svc.answer(req.params.id, req.body.question_id, req.body.choice)));
api.post('/quiz/:id/finish', wrap((req) => svc.finishQuiz(req.params.id)));
api.get('/wrongbook', wrap((req) => svc.wrongbook(req.query)));
api.post('/wrongbook/:wordId', wrap((req) => { svc.setMastered(req.params.wordId, !!req.body.mastered); return { ok: true }; }));
api.get('/stats', wrap(() => svc.stats()));

/* AI proxy (the extension's "server AI" mode and the web app) */
api.post('/ai/chat', wrap(async (req) => {
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error('messages 不能为空'), { status: 400 });
  return { content: await ai.chat(messages.slice(-20), { model: model || undefined }) };
}));
api.get('/ai/models', wrap(async () => ({ models: await ai.models() })));

/* server settings (AI upstream), import / export */
api.get('/settings', wrap(() => { const s = settings(); return { ...s, ai_api_key: mask(s.ai_api_key), categories: CATEGORIES, voices: VOICES }; }));
api.put('/settings', wrap((req) => {
  for (const k of [...AI_KEYS, 'tts_voice']) {
    const v = req.body[k];
    if (typeof v !== 'string') continue;
    if (k === 'ai_api_key' && v.includes('****')) continue; // masked value echoed back
    if (k === 'ai_extra' && v) JSON.parse(v);
    saveSetting(k, v.trim());
  }
  const s = settings();
  return { ...s, ai_api_key: mask(s.ai_api_key) };
}));
api.get('/settings/export', wrap((req) => {
  const s = settings();
  const withKey = req.query.secrets === '1';
  return { type: 'era-server-config', version: 1, exportedAt: new Date().toISOString(), ai: { base_url: s.ai_base_url, api_key: withKey ? s.ai_api_key : '', model: s.ai_model, extra: s.ai_extra }, tts: { voice: s.tts_voice } };
}));
api.post('/settings/import', wrap((req) => {
  const d = req.body || {};
  if (d.type !== 'era-server-config') throw Object.assign(new Error('不是服务器配置文件'), { status: 400 });
  if (d.ai) {
    if (d.ai.base_url) saveSetting('ai_base_url', d.ai.base_url);
    if (d.ai.api_key) saveSetting('ai_api_key', d.ai.api_key);
    if (d.ai.model) saveSetting('ai_model', d.ai.model);
    if (typeof d.ai.extra === 'string') saveSetting('ai_extra', d.ai.extra);
  }
  if (d.tts && d.tts.voice) saveSetting('tts_voice', d.tts.voice);
  return { ok: true };
}));
api.get('/export', wrap((req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="era-backup.json"'); return svc.exportAll(); }));

/* Kokoro TTS */
api.get('/tts/voices', wrap(() => ({ voices: VOICES, status: tts.status(), default: settings().tts_voice })));
api.get('/tts', wrap(async (req, res) => {
  const file = await tts.speak(req.query.text, req.query.voice || settings().tts_voice, req.query.speed);
  res.setHeader('Cache-Control', 'private, max-age=31536000');
  res.type('audio/wav').sendFile(file);
}));

/* Fetch an article / PDF for the web reader (server-side, avoids CORS) */
api.get('/fetch', wrap(async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('仅支持 http(s) 链接'), { status: 400 });
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw Object.assign(new Error('不允许访问内网地址'), { status: 400 });
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (EnglishReadingAssistant)' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Object.assign(new Error('抓取失败 HTTP ' + r.status), { status: 502 });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 60 * 1024 * 1024) throw Object.assign(new Error('文件过大'), { status: 413 });
  res.setHeader('X-Final-Url', r.url);
  res.type(r.headers.get('content-type') || 'application/octet-stream').send(buf);
}));

app.use('/api', api);
// userscripts installed from this server also update from it (jsDelivr may be unreachable for the user)
app.get('/userscript/:file', (req, res, next) => {
  const file = path.join(ROOT, 'public', 'userscript', path.basename(req.params.file));
  if (!file.endsWith('.user.js') || !fs.existsSync(file)) return next();
  const self = `${req.protocol}://${req.get('host')}/userscript/`;
  res.type('text/javascript; charset=utf-8').set('Cache-Control', 'no-cache')
    .send(fs.readFileSync(file, 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/gh\/EuHs\/english-reading-assistant@main\/userscript\//g, self));
});
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', index: 'index.html' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, env.HOST || '0.0.0.0', () => {
  console.log(`English Reading Assistant server v${VERSION} on :${PORT}  AI=${ai.configured ? settings().ai_model : 'off'}  TTS=${tts.enabled ? 'on' : 'off'}`);
  const n = svc.resumeEnrichment();
  if (n) console.log(`AI enrichment queued for ${n} word(s)`);
  if (tts.enabled && env.TTS_PRELOAD === '1') tts.load().then(() => console.log('Kokoro TTS ready')).catch((e) => console.warn('Kokoro TTS failed:', e.message));
});
