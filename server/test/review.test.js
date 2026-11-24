import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { Service, REVIEW_MINUTES } from '../src/service.js';

function setup(t, file = ':memory:') {
  const db = openDb(file);
  t.after(() => db.close());
  let time = Date.now();
  const svc = new Service(db, { configured: false }, { clock: () => time });
  return { db, svc, setTime: (v) => (time = v), get time() { return time; } };
}
function word(svc, name = 'organic', extra = {}) {
  return svc.addWord({ word: name, meaning: '有机的', sentence: `This ${name} matters.`, article: { url: 'https://test.invalid/reading', title: 'Reading', category: '科学' }, ...extra });
}
function quiz(svc, mode = 'due', extra = {}) {
  return svc.startQuiz({ size: 1, mode, types: ['en2zh'], ...extra });
}
function raw(db, q) {
  return db.prepare('SELECT * FROM quiz_questions WHERE id=?').get(q.questions[0].id);
}
function answer(f, q, correct = true) {
  const r = raw(f.db, q);
  return f.svc.answer(q.id, r.id, correct ? r.answer : (r.answer + 1) % 4);
}

test('new and existing words retain a single durable schedule; new additions are due immediately', (t) => {
  const f = setup(t), w = word(f.svc);
  assert.deepEqual({ ...f.svc.reviewSummary(), server_now: 0 }, { total: 1, due: 1, new_words: 1, relearning: 0, next_24h: 0, next_due_at: null, server_now: 0, intervals_minutes: REVIEW_MINUTES });
  const q = quiz(f.svc);
  answer(f, q);
  const before = f.svc.getWord(w.id).review;
  f.setTime(f.time + 1000);
  word(f.svc, 'organic', { article: { url: 'https://test.invalid/second', title: 'Second' } });
  assert.deepEqual(f.svc.getWord(w.id).review, { ...before, due: false });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM word_reviews').get().n, 1);
  assert.equal(f.svc.reviewSummary().next_24h, 1);
  assert.equal(f.svc.listWords({ review: 'due' }).total, 0);
  assert.equal(f.svc.listWords({ review: 'scheduled' }).total, 1);
});

test('spaced successes use actual answer time, early practice does not advance, maximum interval remains 60 days', (t) => {
  const f = setup(t), w = word(f.svc);
  for (let i = 0; i < REVIEW_MINUTES.length + 2; i++) {
    const before = f.svc.reviewState(w.id);
    f.setTime(Math.max(f.time, before.due_at) + 1234);
    const q = quiz(f.svc);
    const r = answer(f, q);
    assert.equal(r.review.stage, Math.min(i, REVIEW_MINUTES.length - 1));
    assert.equal(r.review.due_at, f.time + REVIEW_MINUTES[r.review.stage] * 60000);
    const snapshot = f.svc.reviewState(w.id);
    const early = answer(f, quiz(f.svc, 'all'));
    assert.equal(early.review_reason, 'early');
    assert.deepEqual(f.svc.reviewState(w.id), snapshot);
    f.svc.finishQuiz(q.id);
  }
});

test('due mode excludes future words, orders overdue words, respects category/root and retains all four native types', (t) => {
  const f = setup(t);
  const a = word(f.svc, 'organic', { morphology: [{ part: 'organ', type: 'root', meaning: '器官' }] });
  const b = word(f.svc, 'grocery');
  const c = word(f.svc, 'definitive', { article: { url: 'https://test.invalid/art', category: '娱乐' } });
  f.db.prepare('UPDATE word_reviews SET due_at=? WHERE word_id=?').run(f.time + 60000, c.id);
  f.db.prepare('UPDATE word_reviews SET due_at=? WHERE word_id=?').run(f.time - 60000, b.id);
  const q = quiz(f.svc, 'due', { size: 10 });
  const ids = f.db.prepare('SELECT word_id FROM quiz_questions WHERE quiz_id=? ORDER BY idx').all(q.id).map((r) => r.word_id);
  assert.deepEqual(ids, [b.id, a.id]);
  assert.equal(f.svc.reviewSummary({ category: '娱乐' }).due, 0);
  assert.equal(f.svc.reviewSummary({ root: 'organ' }).due, 1);
  assert.equal(quiz(f.svc, 'due', { root: 'organ', size: 10 }).total, 1);
  for (const type of ['cloze', 'ctx', 'zh2en', 'en2zh']) assert.equal(quiz(f.svc, 'due', { types: [type] }).questions[0].type, type);
  assert.throws(() => quiz(f.svc, 'due', { category: '娱乐' }), /没有到期生词/);
  assert.equal(quiz(f.svc, 'all', { size: 30 }).total, 3);
});

test('duplicate answers and invalid submissions cannot double-count or change the saved date', (t) => {
  const f = setup(t), w = word(f.svc), q = quiz(f.svc);
  const r = raw(f.db, q);
  for (const choice of [null, -1, 4, 1.5, '1']) assert.throws(() => f.svc.answer(q.id, r.id, choice), /选项无效/);
  assert.equal(f.svc.stats().totals.answers, 0);
  const first = answer(f, q);
  f.setTime(f.time + 1000);
  const second = answer(f, q, false);
  assert.equal(second.already, true);
  assert.equal(second.correct, true);
  assert.equal(second.chosen, first.chosen);
  assert.equal(second.word.lemma, 'organic');
  assert.equal(second.review.due_at, first.review.due_at);
  assert.equal(f.svc.stats().totals.answers, 1);
  assert.equal(f.svc.reviewState(w.id).repetitions, 1);
  const unfinished = quiz(f.svc, 'all');
  f.svc.finishQuiz(unfinished.id);
  assert.throws(() => answer(f, unfinished), /测验已结束/);
});

test('wrong answers return immediately; shuffled-option retests recover once without changing quiz scores', (t) => {
  const f = setup(t), w = word(f.svc), q = quiz(f.svc);
  const wrong = answer(f, q, false);
  assert.equal(wrong.review.due_at, f.time);
  assert.equal(wrong.review.stage, -1);
  assert.equal(f.svc.reviewSummary().relearning, 1);
  assert.equal(f.svc.wrongbook()[0].id, w.id);
  f.svc.finishQuiz(q.id);
  const row = raw(f.db, q), stats = f.svc.stats().totals;
  assert.equal(f.svc.retestAnswer(q.id, row.id, (row.answer + 1) % 4).review_updated, false);
  const recovered = f.svc.retestAnswer(q.id, row.id, row.answer);
  assert.equal(recovered.correct, true);
  assert.equal(recovered.review_updated, true);
  assert.equal(recovered.review.due_at, f.time + 20 * 60000);
  f.setTime(f.time + 3600000);
  assert.equal(f.svc.retestAnswer(q.id, row.id, row.answer).review_updated, false);
  assert.equal(f.svc.reviewState(w.id).due_at, recovered.review.due_at);
  const next = answer(f, quiz(f.svc));
  assert.equal(next.review.stage, 1);
  assert.equal(next.review.due_at, f.time + 86400000);
  const saved = f.svc.reviewState(w.id);
  f.svc.retestAnswer(q.id, row.id, row.answer);
  assert.deepEqual(f.svc.reviewState(w.id), saved);
  assert.equal(stats.answers, 1);
  assert.equal(f.svc.stats().totals.answers, 2);
  assert.equal(f.svc.getQuiz(q.id).correct, 0);
});

test('old or concurrent quizzes cannot overwrite newer review outcomes', (t) => {
  const f = setup(t), w = word(f.svc), a = quiz(f.svc), b = quiz(f.svc);
  answer(f, a);
  const saved = f.svc.reviewState(w.id);
  assert.equal(answer(f, b, false).review_reason, 'newer');
  assert.deepEqual(f.svc.reviewState(w.id), saved);
  f.svc.finishQuiz(b.id);
  const row = raw(f.db, b);
  assert.equal(f.svc.retestAnswer(b.id, row.id, row.answer).review_updated, false);
  assert.deepEqual(f.svc.reviewState(w.id), saved);
});

test('unanswered words keep their schedule; finish and history views never reschedule', (t) => {
  const f = setup(t), w = word(f.svc), q = quiz(f.svc);
  const saved = f.svc.reviewState(w.id);
  const result = f.svc.finishQuiz(q.id);
  assert.equal(result.wrong.length, 1);
  assert.equal(result.questions[0].review.due_at, saved.due_at);
  f.svc.finishQuiz(q.id);
  f.svc.getQuiz(q.id);
  assert.deepEqual(f.svc.reviewState(w.id), saved);
  const row = raw(f.db, q);
  assert.equal(f.svc.retestAnswer(q.id, row.id, row.answer).review_updated, true);
  assert.equal(f.svc.reviewState(w.id).stage, 0);
});

test('mistakes in early practice reset the schedule even for a mastered wrong-book word', (t) => {
  const f = setup(t), w = word(f.svc);
  answer(f, quiz(f.svc), false);
  f.svc.setMastered(w.id, true);
  const first = answer(f, quiz(f.svc, 'all'));
  assert.equal(first.review.stage, 0);
  const mistake = answer(f, quiz(f.svc, 'all'), false);
  assert.equal(mistake.review.stage, -1);
  assert.equal(mistake.review.due_at, f.time);
  assert.equal(f.svc.wrongbook()[0].mastered, false);
  assert.equal(f.svc.reviewSummary().due, 1);
});

test('review changes and answer statistics commit atomically', (t) => {
  const f = setup(t), w = word(f.svc), q = quiz(f.svc);
  f.db.exec("CREATE TRIGGER fail_review BEFORE UPDATE ON word_reviews BEGIN SELECT RAISE(ABORT,'test disk failure'); END;");
  assert.throws(() => answer(f, q, false), /test disk failure/);
  assert.equal(raw(f.db, q).chosen, null);
  assert.equal(f.svc.getQuiz(q.id).correct, 0);
  assert.equal(f.svc.wrongbook().length, 0);
  assert.equal(f.svc.reviewState(w.id).repetitions, 0);
});

test('migration preserves existing vocab, scores and settings and survives reopen without resetting schedules', () => {
  // Kept as a small verification fixture; no recursive cleanup or user data access.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'euhs-review-migration-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE words(id INTEGER PRIMARY KEY,lemma TEXT UNIQUE NOT NULL,phonetic TEXT,pos TEXT,translation TEXT,meaning TEXT,definitions TEXT,morphology TEXT,forms TEXT,tenses TEXT,etymology TEXT,enriched INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);
    CREATE TABLE quizzes(id INTEGER PRIMARY KEY,created_at TEXT,finished_at TEXT,size INTEGER,category TEXT,root TEXT,mode TEXT,total INTEGER DEFAULT 0,correct INTEGER DEFAULT 0);
    CREATE TABLE quiz_questions(id INTEGER PRIMARY KEY,quiz_id INTEGER,idx INTEGER,word_id INTEGER,type TEXT,prompt TEXT,hint TEXT,options TEXT,answer INTEGER,chosen INTEGER,correct INTEGER,answered_at TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO words(id,lemma,meaning) VALUES(1,'organic','有机的');
    INSERT INTO quizzes(id,total,correct) VALUES(1,1,1);
    INSERT INTO quiz_questions(id,quiz_id,word_id,chosen,correct) VALUES(1,1,1,0,1);
    INSERT INTO settings VALUES('keep_test','unchanged');`);
  old.close();
  let db = openDb(file);
  let svc = new Service(db, { configured: false });
  assert.equal(svc.reviewSummary().new_words, 1);
  assert.equal(svc.stats().totals.correct, 1);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='keep_test'").get().value, 'unchanged');
  assert.ok(svc.exportAll().tables.word_reviews.length);
  const q = quiz(svc), r = raw(db, q);
  svc.answer(q.id, r.id, r.answer);
  const saved = svc.reviewState(1);
  db.close();
  db = openDb(file);
  svc = new Service(db, { configured: false });
  assert.deepEqual(svc.reviewState(1), saved);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  svc.deleteWord(1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_reviews').get().n, 0);
  db.close();
});
