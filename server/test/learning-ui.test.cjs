const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');
const path = require('node:path');
const base = path.join(__dirname, '..') + path.sep;
const html = fs.readFileSync(base + 'public/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const source = fs.readFileSync(base + 'public/app.js', 'utf8');
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const until = async (fn) => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); } throw new Error('UI state did not arrive'); };

const contextContent = () => {
  const evidence = 'Maya chose organic food after reading the labels.';
  return { title: 'A Market Visit <img src=x onerror="window.bad=1">', paragraphs: [{ en: evidence + ' She wanted to prepare a healthy dinner for her family without spending too much money. At the market she read the labels carefully and compared several products before making a decision. A worker explained where the food had come from. Maya asked questions and learned how to judge the available information. She went home with vegetables and a plan for a simple dinner. <script>window.bad=1</script>', zh: '玛雅买菜前仔细看了标签。' }], questions: Array.from({ length: 3 }, () => ({ prompt: 'What did Maya choose?', options: ['Organic food', 'A train ticket', 'A book', 'New shoes'], answer: 0, explanation: '第一句说明她选择了有机食品。', evidence })), mnemonics: [{ lemma: 'organic', hint: '把 organic 和玛雅选择有机食品的画面联系起来。' }] };
};

async function mount(t, intercept = null, seed = null, options = {}) {
  const { openDb } = await import(pathToFileURL(base + 'src/db.js'));
  const { Service } = await import(pathToFileURL(base + 'src/service.js'));
  const { ContextService } = await import(pathToFileURL(base + 'src/context.js'));
  const db = openDb(':memory:'), svc = new Service(db, { configured: false });
  svc.addWord({ word: 'organic', meaning: '有机的', sentence: 'The organic food is good.', article: { url: 'https://test.invalid/food', category: '科学' } });
  const ctx = new ContextService(db, svc, { configured: true, chat: options.chat || (async () => contextContent()) });
  if (seed) await seed(svc, db, ctx);
  const dom = new JSDOM(html, { url: 'http://local.test/' + (options.hash || '#/quiz'), runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  const dispatch = async (method, url, body) => {
    const u = new URL(url, w.location.origin), p = u.pathname, f = Object.fromEntries(u.searchParams);
    if (p === '/api/roots') return svc.listRoots(f);
    if (p === '/api/categories') return svc.categories();
    if (p === '/api/review') return svc.reviewSummary(f);
    if (p === '/api/words') return svc.listWords(f);
    if (/^\/api\/words\/\d+$/.test(p)) return svc.getWord(+p.split('/').pop());
    if (p === '/api/contexts/options') return options.candidates ? options.candidates() : ctx.candidates(f);
    if (p === '/api/contexts') return method === 'GET' ? ctx.list() : ctx.create(body);
    const c = p.match(/^\/api\/contexts\/(\d+)(?:\/(retry|reading-answer|analysis|consolidate))?$/);
    if (c) {
      if (!c[2]) return ctx.get(+c[1]);
      if (c[2] === 'retry') return ctx.retry(+c[1]);
      if (c[2] === 'reading-answer') return ctx.readingAnswer(+c[1], body.idx, body.choice);
      if (c[2] === 'analysis') return ctx.analysis(+c[1]);
      return ctx.consolidate(+c[1]);
    }
    if (p === '/api/quiz') return method === 'GET' ? svc.listQuizzes() : svc.startQuiz(body);
    const m = p.match(/^\/api\/quiz\/(\d+)(?:\/(answer|finish|retest))?$/);
    if (m) {
      if (!m[2]) return svc.getQuiz(+m[1]);
      if (m[2] === 'finish') return svc.finishQuiz(+m[1]);
      if (m[2] === 'answer') {
        const perform = () => svc.answer(+m[1], body.question_id, body.choice);
        return intercept ? intercept(perform) : perform();
      }
      return svc.retestAnswer(+m[1], body.question_id, body.choice);
    }
    throw new Error('Unexpected test route: ' + method + ' ' + url);
  };
  w.ERA = { escapeHtml: escape, CATEGORIES: ['科学'], UI: { toast: () => {} }, serverCall: dispatch,
    init: async () => {}, speak: async () => {}, highlightWord: escape };
  w.WebP = { token: () => 'test-session', setToken: () => {} };
  w.fetch = async () => ({ ok: true, json: async () => ({ user: 'fixture', mustChange: false }) });
  w.confirm = () => true;
  w.scrollTo = () => {};
  t.after(() => { dom.window.close(); db.close(); });
  w.eval(fs.readFileSync(base + 'public/context.js', 'utf8'));
  w.eval(source);
  await until(() => d.querySelector('#hist table') || d.querySelector('#hist .muted') || d.querySelector('#context-new') || d.querySelector('.context-passage'));
  return { w, d, db, svc, ctx, click: (s) => { const el = d.querySelector(s); assert.ok(el, s); el.click(); } };
}

async function seededContext(_svc, _db, ctx) {
  const s = ctx.create({ word_ids: [1], request_key: 'context-ui-test-request-01' });
  await until(() => ctx.get(s.id).status === 'ready');
}

test('resuming a fully answered quiz renders results and preserves its saved schedule', async (t) => {
  let saved;
  const f = await mount(t, null, (svc, db) => {
    const q = svc.startQuiz({ size: 1, types: ['en2zh'] });
    const r = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id=?').get(q.id);
    saved = svc.answer(q.id, r.id, r.answer).review;
  });
  f.click('[data-resume]');
  await until(() => f.d.querySelector('h2')?.textContent === '测验结果');
  assert.equal(f.d.querySelector('.score').textContent, '1 / 1');
  assert.equal(f.svc.reviewState(1).due_at, saved.due_at);
  assert.match(f.d.querySelector('.review-list').textContent, /organic.*下次/);
});

test('a lost answer response can be retried with a different click without double scoring or displaying the wrong choice', async (t) => {
  let calls = 0;
  const f = await mount(t, (perform) => {
    const r = perform();
    if (!calls++) throw new Error('simulated connection lost after commit');
    return r;
  });
  f.click('#start');
  await until(() => f.d.querySelector('.opt'));
  const row = f.db.prepare('SELECT * FROM quiz_questions ORDER BY id DESC').get();
  f.click(`.opt[data-k="${row.answer}"]`);
  await until(() => /保存失败/.test(f.d.querySelector('#fb')?.textContent || ''));
  assert.equal(f.d.querySelectorAll('.opt:disabled').length, 0);
  f.click(`.opt[data-k="${(row.answer + 1) % 4}"]`);
  await until(() => f.d.querySelector('#next'));
  assert.match(f.d.querySelector('#fb').textContent, /正确/);
  assert.equal(f.d.querySelectorAll('.opt.wrong').length, 0);
  f.click('#next');
  await until(() => f.d.querySelector('.score'));
  assert.equal(f.d.querySelector('.score').textContent, '1 / 1');
  assert.equal(f.svc.stats().totals.answers, 1);
  assert.equal(f.svc.reviewState(1).repetitions, 1);
});

test('Enter during saving cannot skip an answer, and its late response cannot replace a different page', async (t) => {
  let release;
  const f = await mount(t, (perform) => new Promise((resolve) => { release = () => resolve(perform()); }));
  f.click('#start');
  await until(() => f.d.querySelector('.opt'));
  f.click('.opt');
  await until(() => release);
  f.d.onkeydown({ key: 'Enter' });
  assert.ok(f.d.querySelector('.opt'));
  assert.equal(f.d.querySelectorAll('.opt:disabled').length, 4);
  f.click('#nav a[href="#/words"]');
  await until(() => /生词本/.test(f.d.querySelector('h2')?.textContent || ''));
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(f.d.querySelector('h2').textContent, /生词本/);
  assert.equal(f.svc.stats().totals.answers, 1);
});

test('context setup creates a saved story with highlighted dictionary, translation and escaped AI content', async (t) => {
  const f = await mount(t, null, null, { hash: '#/context' });
  f.click('#context-new');
  await until(() => f.d.querySelector('#context-generate'));
  assert.equal(f.d.querySelector('#context-selected-count').textContent, '1');
  f.click('[name="context-topic"][value="旅行出行"]');
  f.click('[name="context-level"][value="easy"]');
  f.click('#context-generate');
  await until(() => f.d.querySelector('.context-passage'));
  assert.equal(f.ctx.list().length, 1);
  assert.equal(f.ctx.get(1).topic, '旅行出行');
  assert.equal(f.ctx.get(1).difficulty, 'easy');
  assert.equal(f.d.querySelectorAll('.context-passage script,.context-passage img').length, 0);
  assert.equal(f.w.bad, undefined);
  assert.ok(f.d.querySelector('.context-zh').hidden);
  f.click('#context-translate');
  assert.equal(f.d.querySelector('.context-zh').hidden, false);
  f.click('[data-context-word]');
  assert.equal(f.d.querySelector('#modal').hidden, false);
  assert.match(f.d.querySelector('.modal-body').textContent, /语境提示.*organic/);
});

test('reading choices, viewed analyses and translation survive redraws, and reading does not change spaced dates', async (t) => {
  const f = await mount(t, null, seededContext, { hash: '#/context/1' });
  const saved = f.svc.reviewState(1);
  f.click('#context-translate');
  f.click('#context-analysis');
  await until(() => f.d.querySelector('#context-analysis')?.textContent === '解析已显示');
  f.click('[data-reading-idx="0"][data-reading-choice="0"]');
  await until(() => f.d.querySelector('.context-question .feedback'));
  assert.equal(f.ctx.get(1).reading.assisted, 1);
  assert.equal(f.d.querySelector('.context-zh').hidden, false);
  assert.deepEqual(f.svc.reviewState(1), saved);
  assert.equal(f.svc.stats().totals.quizzes, 0);
  f.click('#nav a[href="#/context"]');
  await until(() => f.d.querySelector('#context-new'));
  f.click('a[href="#/context/1"]');
  await until(() => f.d.querySelector('.context-passage'));
  assert.match(f.d.querySelector('#context-reading').textContent, /已答 1 \/ 3/);
  assert.match(f.d.querySelector('.context-passage').textContent, /阅读题解析/);
});

test('context consolidation resumes one native quiz, renders combined results and can reopen the same fragment', async (t) => {
  const f = await mount(t, null, seededContext, { hash: '#/context/1' });
  f.click('#context-consolidate');
  await until(() => f.d.querySelector('#context-return'));
  f.click('#context-return');
  await until(() => f.d.querySelector('.context-passage'));
  f.click('#context-consolidate');
  await until(() => f.d.querySelector('#context-return'));
  const q = f.db.prepare('SELECT * FROM quiz_questions ORDER BY id DESC').get();
  f.click(`.opt[data-k="${q.answer}"]`);
  await until(() => f.d.querySelector('#next'));
  f.click('#next');
  await until(() => f.d.querySelector('h2')?.textContent === '语境学习完成');
  assert.match(f.d.querySelector('.context-result').textContent, /0 \/ 3.*阅读小测.*1 \/ 1.*单词巩固/);
  assert.equal(f.svc.stats().totals.quizzes, 1);
  assert.equal(f.svc.stats().totals.answers, 1);
  assert.equal(f.svc.reviewState(1).stage, 0);
  f.click('#context-reread');
  await until(() => f.d.querySelector('.context-passage'));
  assert.equal(f.ctx.get(1).consolidation_quiz_id, q.quiz_id);
});

test('a failed, dismissed word-picker request cannot replace a later dictionary popup', async (t) => {
  let rejectCandidates;
  const f = await mount(t, null, seededContext, { hash: '#/context/1', candidates: () => new Promise((_resolve, reject) => (rejectCandidates = reject)) });
  const pending = f.w.ERA.ContextUI.open({ scope: 'all' });
  await until(() => rejectCandidates);
  f.click('.modal-x');
  f.click('[data-context-word]');
  assert.match(f.d.querySelector('.modal-body').textContent, /语境提示/);
  rejectCandidates(new Error('simulated disconnected server'));
  await pending;
  assert.match(f.d.querySelector('.modal-body').textContent, /语境提示/);
  assert.doesNotMatch(f.d.querySelector('.modal-body').textContent, /disconnected/);
});
