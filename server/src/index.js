// English Reading Assistant — server entry: REST API + web app.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';
import { Service } from './service.js';
import { AIClient, lookup, CATEGORIES, ERA } from './lexicon.js';
import { TTS, VOICES } from './tts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env */ }

const env = process.env;
const PORT = +env.PORT || 8080;
const DATA = path.resolve(ROOT, env.DATA_DIR || 'data');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const db = openDb(path.join(DATA, 'era.db'));

/* ---------- settings: env defaults, overridable from the web app (stored in DB) ---------- */
const AI_KEYS = ['ai_base_url', 'ai_api_key', 'ai_model', 'ai_extra', 'ai_temperature', 'ai_top_p', 'ai_max_tokens', 'ai_reasoning', 'ai_reasoning_format', 'ai_model_info',
  'ai_type', 'ai_headers', 'ai_relay_url', 'ai_relay_mode', 'ai_relay_target_header', 'ai_relay_key'];
const SECRET_KEYS = ['ai_api_key', 'ai_relay_key']; // masked when read, and a masked value echoed back is not saved
function settings() {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return {
    ai_base_url: rows.ai_base_url ?? env.AI_BASE_URL ?? '',
    ai_api_key: rows.ai_api_key ?? env.AI_API_KEY ?? '',
    ai_model: rows.ai_model ?? env.AI_MODEL ?? 'glm-4.6',
    ai_extra: rows.ai_extra ?? env.AI_EXTRA ?? '',
    // generic request parameters, written per provider by the shared builder ('' = not sent)
    ai_temperature: rows.ai_temperature ?? env.AI_TEMPERATURE ?? '0.2',
    ai_top_p: rows.ai_top_p ?? env.AI_TOP_P ?? '',
    ai_max_tokens: rows.ai_max_tokens ?? env.AI_MAX_TOKENS ?? '',
    ai_reasoning: rows.ai_reasoning ?? env.AI_REASONING ?? '',
    ai_reasoning_format: rows.ai_reasoning_format ?? env.AI_REASONING_FORMAT ?? 'auto',
    ai_model_info: rows.ai_model_info ?? '', // what the provider's /models said about the chosen model
    // direct, or through a relay (one-api / new-api / LiteLLM / a forwarder) — the same structure as the extension's 跳板
    ai_type: rows.ai_type ?? env.AI_TYPE ?? 'openai',
    ai_headers: rows.ai_headers ?? env.AI_HEADERS ?? '',
    ai_relay_url: rows.ai_relay_url ?? env.AI_RELAY_URL ?? '',
    ai_relay_mode: rows.ai_relay_mode ?? env.AI_RELAY_MODE ?? 'openai',
    ai_relay_target_header: rows.ai_relay_target_header ?? env.AI_RELAY_TARGET_HEADER ?? 'X-Target-URL',
    ai_relay_key: rows.ai_relay_key ?? env.AI_RELAY_KEY ?? '',
    tts_voice: rows.tts_voice ?? env.TTS_VOICE ?? 'af_heart',
  };
}
const saveSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
// up to 1.5 the default extra JSON switched Z.AI thinking off; that is the thinking level "off" now, and left in the
// extra JSON it would override whatever level is chosen (the DB value also takes precedence over .env's AI_EXTRA)
if (getSetting('ai_reasoning') == null && String(settings().ai_extra).replace(/\s/g, '') === '{"thinking":{"type":"disabled"}}') {
  saveSetting('ai_reasoning', 'off');
  saveSetting('ai_extra', '');
}
const mask = (k) => (k ? k.slice(0, 4) + '****' + k.slice(-4) : '');

/* ---------- web app admin account, and the API token that extensions / userscripts use ---------- */
const DEFAULT_PASSWORD = '123456';
const hashPass = (p, salt = crypto.randomBytes(16).toString('hex')) => `scrypt:${salt}:${crypto.scryptSync(String(p), salt, 64).toString('hex')}`;
const passOk = (p, stored) => {
  const [, salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const a = crypto.scryptSync(String(p), salt, 64), b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
if (!getSetting('admin_pass')) { // first start: admin / 123456 unless .env says otherwise; the default must be changed at first login
  saveSetting('admin_user', env.ADMIN_USER || 'admin');
  saveSetting('admin_pass', hashPass(env.ADMIN_PASSWORD || DEFAULT_PASSWORD));
  saveSetting('admin_must_change', env.ADMIN_PASSWORD && env.ADMIN_PASSWORD !== DEFAULT_PASSWORD ? '0' : '1');
}
const mustChange = () => getSetting('admin_must_change') === '1';
// regenerated from the web app it lives in the DB; until then it is API_TOKEN from .env
const apiToken = () => getSetting('api_token') ?? env.API_TOKEN ?? '';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SESSION_DAYS = 30;
function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  db.prepare('INSERT INTO sessions(token_hash, username, expires_at) VALUES(?, ?, datetime(\'now\', ?))').run(sha(token), user, `+${SESSION_DAYS} days`);
  return token;
}
const sessionOk = (t) => !!t && !!db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at > datetime('now')").get(sha(t));

const ai = new AIClient(settings);
const svc = new Service(db, ai);
const tts = new TTS({ dataDir: DATA, enabled: env.ENABLE_TTS !== '0', dtype: env.KOKORO_DTYPE, hfEndpoint: env.HF_ENDPOINT });

if (!apiToken()) console.warn('⚠️  API_TOKEN 未设置：扩展用的 API 对所有人开放。请在 .env 中设置 API_TOKEN，或在网页应用的设置里生成。');

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
  const want = apiToken();
  if (!want) return true;
  if (!t) return false;
  const a = Buffer.from(String(t)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const bearer = (req) => { const h = req.get('authorization') || ''; return h.startsWith('Bearer ') ? h.slice(7) : req.get('x-api-key') || req.query.token; };
// the web app signs in as the admin (a session token); extensions and userscripts send the API token
const caller = (req) => { const t = bearer(req); return sessionOk(t) ? 'admin' : tokenOk(t) ? 'token' : null; };
function auth(req, res, next) {
  req.caller = caller(req);
  if (!req.caller) return res.status(401).json({ error: '未授权：请登录，或提供正确的 API Token' });
  if (req.caller === 'admin' && mustChange()) return res.status(403).json({ error: '请先修改默认密码', mustChange: true });
  next();
}
const adminOnly = (req, res, next) => (req.caller === 'admin' ? next() : res.status(403).json({ error: '需要在网页应用中登录管理员账号' }));
const wrap = (fn) => async (req, res) => {
  try { const r = await fn(req, res); if (r !== undefined && !res.headersSent) res.json(r); }
  catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ error: e.message }); if (!e.status) console.error(e); }
};

/* ---------- public ---------- */
app.get('/api/health', (req, res) => {
  const authed = !!caller(req);
  res.json({ ok: true, name: 'english-reading-assistant', version: VERSION, ai: ai.configured, tts: tts.status(), authRequired: !!apiToken(), authed, ...(authed ? { words: db.prepare('SELECT COUNT(*) n FROM words').get().n } : {}) });
});

/* ---------- web app login ---------- */
const failures = new Map(); // socket address -> { n, until }: 10 wrong passwords lock that address out for 15 minutes
app.post('/api/auth/login', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const f = failures.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: '密码错误次数过多，请 15 分钟后再试' });
  const { username = '', password = '' } = req.body || {};
  const ok = passOk(password, getSetting('admin_pass')) && String(username).trim() === getSetting('admin_user');
  if (!ok) {
    if (failures.size > 5000) failures.clear();
    failures.set(ip, f.n + 1 >= 10 ? { n: 0, until: Date.now() + 15 * 60e3 } : { n: f.n + 1, until: 0 });
    return res.status(401).json({ error: '账号或密码不正确' });
  }
  failures.delete(ip);
  res.json({ token: newSession(getSetting('admin_user')), user: getSetting('admin_user'), mustChange: mustChange() });
});
const account = express.Router(); // needs the admin session, and stays open while the default password is in use
account.use((req, res, next) => (sessionOk(bearer(req)) ? next() : res.status(401).json({ error: '未授权：请登录' })));
account.get('/me', (req, res) => res.json({ user: getSetting('admin_user'), mustChange: mustChange() }));
account.post('/logout', (req, res) => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(bearer(req))); res.json({ ok: true }); });
account.post('/password', wrap((req) => {
  const { current = '', password = '', username } = req.body || {};
  const user = String(username ?? getSetting('admin_user')).trim();
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!passOk(current, getSetting('admin_pass'))) throw bad('当前密码不正确');
  if (!user) throw bad('账号不能为空');
  if (String(password).length < 6) throw bad('新密码至少 6 位');
  if (password === DEFAULT_PASSWORD || password === current) throw bad('请换一个新密码（不能是默认密码或当前密码）');
  saveSetting('admin_user', user);
  saveSetting('admin_pass', hashPass(password));
  saveSetting('admin_must_change', '0');
  db.prepare('DELETE FROM sessions WHERE token_hash<>?').run(sha(bearer(req))); // other browsers sign in again
  return { ok: true, user };
}));
app.use('/api/auth', account);

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
  const { messages, model, fresh } = req.body || {}; // fresh: a settings test, show what the provider requires
  if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error('messages 不能为空'), { status: 400 });
  const r = await ai.chat(messages.slice(-20), { model: model || undefined, withNotes: true, fresh: !!fresh });
  return { content: r.content, notes: r.notes }; // notes: parameters adapted to the provider's errors
}));
api.get('/ai/models', wrap(async () => { const { ids, info } = await ai.models(); return { models: ids, info }; }));

/* the API token extensions and userscripts connect with: shown and regenerated in the web app's settings */
api.get('/settings/api-token', adminOnly, wrap(() => ({ token: apiToken() })));
api.post('/settings/api-token', adminOnly, wrap(() => { const t = crypto.randomBytes(24).toString('hex'); saveSetting('api_token', t); return { token: t }; }));
api.put('/settings/api-token', adminOnly, wrap((req) => {
  const t = String((req.body || {}).token || '').trim();
  // it travels in an HTTP header and nothing rate-limits wrong tokens, so keep it header-safe and not too short
  if (!/^[A-Za-z0-9._~+/=-]{12,128}$/.test(t)) throw Object.assign(new Error('Token 需 12–128 位，只能用字母、数字和 . _ ~ + / = -'), { status: 400 });
  saveSetting('api_token', t);
  return { token: t };
}));

/* server settings (AI upstream), import / export: admin only, they hold the AI key */
api.get('/settings', adminOnly, wrap(() => ({ ...masked(settings()), categories: CATEGORIES, voices: VOICES })));
function checkSetting(k, v) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!v) return;
  if ((k === 'ai_temperature' || k === 'ai_top_p') && isNaN(+v)) throw bad(`${k === 'ai_temperature' ? '温度' : 'top_p'}必须是数字，或留空`);
  if (k === 'ai_max_tokens' && !/^\d+$/.test(v)) throw bad('最大输出 tokens 必须是正整数，或留空');
  if (k === 'ai_reasoning_format' && !ERA.REASONING_FORMATS[v]) throw bad('不认识的思考参数写法：' + v);
  if (k === 'ai_extra') try { ERA.parseExtra(v); } catch (e) { throw bad(e.message); }
  if (k === 'ai_model_info') try { JSON.parse(v); } catch { throw bad('模型信息不是合法 JSON'); }
  if (k === 'ai_type' && !['openai', 'relay'].includes(v)) throw bad('类型只能是 openai 或 relay');
  if (k === 'ai_relay_mode' && !['openai', 'forward'].includes(v)) throw bad('跳板模式只能是 openai 或 forward');
  if (k === 'ai_relay_url' && !/^https?:\/\/\S+$/i.test(v)) throw bad('跳板地址要以 http:// 或 https:// 开头');
  if (k === 'ai_relay_target_header' && !/^[A-Za-z0-9-]+$/.test(v)) throw bad('上游地址请求头只能用字母、数字和 -');
  if (k === 'ai_headers') {
    let o;
    try { o = JSON.parse(v); } catch { throw bad('附加请求头不是合法 JSON'); }
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.values(o).some((x) => typeof x !== 'string')) throw bad('附加请求头应为 {"名称":"值"} 形式的 JSON');
  }
}
const masked = (s) => ({ ...s, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, mask(s[k])])) });
api.put('/settings', adminOnly, wrap((req) => {
  const changes = [...AI_KEYS, 'tts_voice'].map((k) => [k, req.body[k]])
    .filter(([k, v]) => typeof v === 'string' && !(SECRET_KEYS.includes(k) && v.includes('****'))) // a masked key is echoed back
    .map(([k, v]) => [k, v.trim()]);
  changes.forEach(([k, v]) => checkSetting(k, v)); // all valid before anything is saved
  changes.forEach(([k, v]) => saveSetting(k, v));
  return masked(settings());
}));
api.get('/settings/export', adminOnly, wrap((req) => {
  const s = settings();
  const withKey = req.query.secrets === '1';
  return { type: 'era-server-config', version: 1, exportedAt: new Date().toISOString(), ai: { base_url: s.ai_base_url, api_key: withKey ? s.ai_api_key : '', model: s.ai_model, extra: s.ai_extra,
    params: { temperature: s.ai_temperature, top_p: s.ai_top_p, max_tokens: s.ai_max_tokens, reasoning: s.ai_reasoning, reasoning_format: s.ai_reasoning_format },
    type: s.ai_type, headers: s.ai_headers,
    relay: { url: s.ai_relay_url, mode: s.ai_relay_mode, target_header: s.ai_relay_target_header, key: withKey ? s.ai_relay_key : '' } }, tts: { voice: s.tts_voice } };
}));
api.post('/settings/import', adminOnly, wrap((req) => {
  const d = req.body || {};
  if (d.type !== 'era-server-config') throw Object.assign(new Error('不是服务器配置文件'), { status: 400 });
  if (d.ai) {
    if (d.ai.base_url) saveSetting('ai_base_url', d.ai.base_url);
    if (d.ai.api_key) saveSetting('ai_api_key', d.ai.api_key);
    if (d.ai.model) saveSetting('ai_model', d.ai.model);
    if (typeof d.ai.extra === 'string') saveSetting('ai_extra', d.ai.extra);
    const ps = d.ai.params || {};
    const rl = d.ai.relay || {};
    const fields = [[ps.temperature, 'ai_temperature'], [ps.top_p, 'ai_top_p'], [ps.max_tokens, 'ai_max_tokens'], [ps.reasoning, 'ai_reasoning'], [ps.reasoning_format, 'ai_reasoning_format'],
      [d.ai.type, 'ai_type'], [d.ai.headers, 'ai_headers'], [rl.url, 'ai_relay_url'], [rl.mode, 'ai_relay_mode'], [rl.target_header, 'ai_relay_target_header'], [rl.key || undefined, 'ai_relay_key']]
      .filter(([v]) => typeof v === 'string').map(([v, key]) => [v.trim(), key]);
    fields.forEach(([v, key]) => checkSetting(key, v));
    fields.forEach(([v, key]) => saveSetting(key, v));
  }
  if (d.tts && d.tts.voice) saveSetting('tts_voice', d.tts.voice);
  return { ok: true };
}));
api.get('/export', adminOnly, wrap((req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="era-backup.json"'); return svc.exportAll(); }));

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
// the page asks for app.js?v=<version> and friends, and html / js / css are revalidated on every load,
// so an upgraded server takes effect at once instead of after the browser's cache expires
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
  .replace(/(src|href)="((?!https?:)[^"?]+\.(?:js|css))"/g, `$1="$2?v=${VERSION}"`);
app.get(['/', '/index.html'], (req, res) => res.type('html').set('Cache-Control', 'no-cache').send(indexHtml));
app.use(express.static(path.join(ROOT, 'public'), {
  maxAge: '1h',
  setHeaders: (res, file) => { if (/\.(html|js|css)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, env.HOST || '0.0.0.0', () => {
  console.log(`English Reading Assistant server v${VERSION} on :${PORT}  AI=${ai.configured ? settings().ai_model : 'off'}  TTS=${tts.enabled ? 'on' : 'off'}`);
  const n = svc.resumeEnrichment();
  if (n) console.log(`AI enrichment queued for ${n} word(s)`);
  if (tts.enabled && env.TTS_PRELOAD === '1') tts.load().then(() => console.log('Kokoro TTS ready')).catch((e) => console.warn('Kokoro TTS failed:', e.message));
});
