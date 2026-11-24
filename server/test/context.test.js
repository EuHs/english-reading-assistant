import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Service } from '../src/service.js';
import { ContextService, validateContent, TOPICS } from '../src/context.js';

function output(names = ['organic', 'grocery']) {
  const evidence = `Maya saw ${names.join(' and ')} on her shopping list.`;
  return { title: 'A Thoughtful Shopping Trip', paragraphs: [{ en: evidence + ' She wanted to prepare a healthy dinner for her family without spending too much money. At the market she read the labels carefully and compared the prices of several products. A friendly worker explained where the food had come from. Maya asked questions instead of simply choosing the most expensive items. Finally, she returned home with fresh vegetables and a clear plan for the evening meal. The experience taught her that careful decisions begin with useful information.', zh: '玛雅看了购物清单，准备为家人做饭。她比较价格、询问食物来源，并学习如何根据可靠信息作出选择。' }],
    questions: Array.from({ length: 3 }, (_, i) => ({ prompt: ['What did Maya read?', 'Where was the shopping list?', 'Who went shopping?'][i], options: ['Her shopping list', 'A story book', 'A map', 'A newspaper'], answer: 0, explanation: '原文提到玛雅查看购物清单，因此选择A。', evidence })),
    mnemonics: names.map((lemma) => ({ lemma, hint: '把这个词和玛雅购物的情景联系起来。' })) };
}
function setup(t, chat = async () => output()) {
  const db = openDb(':memory:');
  let clock = Date.now();
  const svc = new Service(db, { configured: false }, { clock: () => clock });
  const ai = { configured: true, chat };
  const ctx = new ContextService(db, svc, ai);
  const ids = ['organic', 'grocery', 'dilemma'].map((word) => svc.addWord({ word, sentence: `This ${word} is useful.`, article: { url: 'https://test.invalid/reading', category: '科学' } }).id);
  t.after(() => db.close());
  return { db, svc, ctx, ai, ids, setTime: (v) => (clock = v), get time() { return clock; } };
}
const create = (f, extra = {}) => f.ctx.create({ word_ids: f.ids.slice(0, 2), request_key: 'context-test-request-0001', ...extra });
async function settled(f, id) {
  for (let i = 0; i < 100; i++) {
    const study = f.ctx.get(id);
    if (study.status !== 'generating') return study;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('Generation did not settle');
}

test('one persistent lesson includes all selected words, translations and three questions without exposing unanswered keys', async (t) => {
  const f = setup(t), before = f.ids.map((id) => f.svc.reviewState(id));
  const pending = create(f);
  assert.equal(pending.status, 'generating');
  const s = await settled(f, pending.id);
  assert.equal(s.status, 'ready');
  assert.equal(s.questions.length, 3);
  assert.equal(s.content.paragraphs.length, 1);
  assert.ok(s.content.paragraphs[0].zh);
  assert.equal('answer' in s.questions[0], false);
  assert.equal(s.reading.answered, 0);
  assert.deepEqual(f.ids.map((id) => f.svc.reviewState(id)), before);
  assert.equal(f.svc.stats().totals.quizzes, 0);
  assert.equal(f.svc.exportAll().tables.context_studies.length, 1);
  assert.equal(f.ctx.list()[0].word_count, 2);
  const reopened = new ContextService(f.db, f.svc, f.ai);
  assert.deepEqual(reopened.get(s.id), s);
});

test('duplicate create requests, retry clicks and conflicting request keys do not launch duplicate AI calls', async (t) => {
  let resolve, calls = 0;
  const f = setup(t, () => { calls++; return new Promise((r) => (resolve = r)); });
  const a = create(f), b = create(f);
  assert.equal(a.id, b.id);
  f.ctx.retry(a.id);
  assert.equal(calls, 1);
  assert.throws(() => create(f, { topic: TOPICS[1] }), /请求编号/);
  resolve(output());
  assert.equal((await settled(f, a.id)).status, 'ready');
  assert.equal(create(f).id, a.id);
  assert.equal(calls, 1);
});

test('reading answers and analysis persist, score only the first choice, and do not alter vocabulary review dates', async (t) => {
  const f = setup(t), s = create(f);
  await settled(f, s.id);
  const before = f.ids.map((id) => f.svc.reviewState(id));
  f.ctx.readingAnswer(s.id, 0, 0);
  const repeated = f.ctx.readingAnswer(s.id, 0, 1);
  assert.equal(repeated.questions[0].chosen, 0);
  assert.equal(repeated.reading.correct, 1);
  assert.equal('answer' in repeated.questions[1], false);
  const peek = f.ctx.analysis(s.id);
  assert.equal(peek.questions[1].answer, 0);
  f.ctx.readingAnswer(s.id, 1, 2);
  const resumed = f.ctx.get(s.id);
  assert.deepEqual(resumed.reading, { total: 3, answered: 2, correct: 1, assisted: 1 });
  assert.deepEqual(f.ids.map((id) => f.svc.reviewState(id)), before);
  assert.equal(f.svc.stats().totals.answers, 0);
  assert.throws(() => f.ctx.readingAnswer(s.id, -1, 0), /无效/);
  assert.throws(() => f.ctx.readingAnswer(s.id, 2, '0'), /无效/);
});

test('consolidation uses the selected words and native quiz, resumes the same quiz, and keeps existing scheduling rules', async (t) => {
  const f = setup(t), s = create(f);
  await settled(f, s.id);
  f.db.prepare('UPDATE word_reviews SET stage=2,due_at=? WHERE word_id=?').run(f.time + 3 * 86400000, f.ids[0]);
  const before = f.svc.reviewState(f.ids[0]);
  const quiz = f.ctx.consolidate(s.id);
  assert.equal(quiz.context_id, s.id);
  assert.equal(quiz.total, 2);
  assert.equal(f.ctx.consolidate(s.id).id, quiz.id);
  assert.equal(f.svc.stats().totals.quizzes, 1);
  const rows = f.db.prepare('SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY word_id').all(quiz.id);
  assert.deepEqual(rows.map((r) => r.word_id), f.ids.slice(0, 2));
  assert.ok(rows.every((r) => r.type === 'zh2en'));
  f.svc.answer(quiz.id, rows[0].id, rows[0].answer);
  assert.deepEqual(f.svc.reviewState(f.ids[0]), before);
  const wrong = f.svc.answer(quiz.id, rows[1].id, (rows[1].answer + 1) % 4);
  assert.equal(wrong.review.stage, -1);
  assert.equal(wrong.review.due_at, f.time);
  const result = f.svc.finishQuiz(quiz.id);
  assert.equal(result.context_id, s.id);
  assert.equal(result.wrong.length, 1);
  const recovery = f.svc.retestAnswer(quiz.id, rows[1].id, rows[1].answer);
  assert.equal(recovery.review.due_at, f.time + 20 * 60000);
  assert.equal(f.ctx.consolidate(s.id).finished_at, result.finished_at);
});

test('removed vocabulary does not erase saved stories; consolidation excludes removed words', async (t) => {
  const f = setup(t), s = create(f);
  await settled(f, s.id);
  f.svc.deleteWord(f.ids[0]);
  assert.equal(f.ctx.get(s.id).words.length, 2);
  assert.match(f.ctx.get(s.id).content.paragraphs[0].en, /organic/);
  assert.equal(f.ctx.consolidate(s.id).total, 1);
  const next = create(f, { word_ids: [f.ids[2]], request_key: 'context-test-request-0002' });
  // This fake intentionally misses the selected word, and must not become a valid study.
  assert.equal((await settled(f, next.id)).status, 'failed');
});

test('malformed AI content is rejected and provider errors never expose credentials to the page', async (t) => {
  const f = setup(t, async () => { throw new Error('provider leaked sk-TEST-SECRET in its error'); });
  const s = create(f);
  const failed = await settled(f, s.id);
  assert.equal(failed.status, 'failed');
  assert.doesNotMatch(failed.error, /SECRET|sk-/);
  assert.doesNotMatch(f.ctx.list()[0].error, /SECRET/);
  f.ai.chat = async () => ({ ...output(), title: '' });
  f.ctx.retry(s.id);
  assert.equal((await settled(f, s.id)).status, 'failed');
  f.ai.chat = async () => output();
  f.ctx.retry(s.id);
  assert.equal((await settled(f, s.id)).status, 'ready');
});

test('generation validation requires word coverage, unique options, valid answer indices and quoted evidence', () => {
  const words = [{ id: 1, lemma: 'organic' }, { id: 2, lemma: 'grocery' }];
  assert.doesNotThrow(() => validateContent(output(), words));
  for (const change of [
    (v) => { v.paragraphs[0].en = v.paragraphs[0].en.replace('organic', 'organically'); },
    (v) => { v.questions[0].answer = 4; },
    (v) => { v.questions[1].options[1] = v.questions[1].options[0]; },
    (v) => { v.questions[2].evidence = 'This sentence does not exist.'; },
    (v) => { v.questions.pop(); },
    (v) => { v.paragraphs[0].zh = ''; },
  ]) {
    const v = output(); change(v);
    assert.throws(() => validateContent(v, words));
  }
});

test('interrupted generation is recoverable and late results cannot overwrite a newer retry', async (t) => {
  let finishOld;
  const f = setup(t, () => new Promise((r) => (finishOld = r)));
  const s = create(f);
  const restarted = new ContextService(f.db, f.svc, f.ai);
  assert.equal(restarted.get(s.id).status, 'failed');
  f.ai.chat = async () => ({ ...output(), title: 'The New Retry' });
  restarted.retry(s.id);
  await settled(f, s.id);
  finishOld(output());
  await new Promise((r) => setImmediate(r));
  assert.equal(restarted.get(s.id).content.title, 'The New Retry');
});

test('selection constraints and source scopes reject invalid work without making AI requests', async (t) => {
  let calls = 0;
  const f = setup(t, async () => { calls++; return output(); });
  for (const extra of [{ word_ids: [] }, { word_ids: [f.ids[0], f.ids[0]] }, { word_ids: [999] }, { word_ids: Array.from({ length: 21 }, (_, i) => i + 1) }, { topic: 'unknown' }, { difficulty: '__proto__' }, { source_quiz_id: 999 }]) assert.throws(() => create(f, extra));
  assert.equal(calls, 0);
  assert.equal(f.ctx.candidates({ scope: 'all' }).words.length, 3);
  assert.equal(f.ctx.candidates({ scope: 'wrong' }).words.length, 0);
  f.db.prepare('UPDATE word_reviews SET due_at=? WHERE word_id=?').run(f.time + 100000, f.ids[0]);
  assert.equal(f.ctx.candidates({ scope: 'due' }).words.length, 2);
  const q = f.svc.startQuiz({ size: 1, word_ids: [f.ids[1]], types: ['en2zh'] });
  assert.deepEqual(f.ctx.candidates({ quiz_id: q.id }).words.map((w) => w.id), [f.ids[1]]);
  f.ai.configured = false;
  assert.throws(() => create(f), /配置/);
});
