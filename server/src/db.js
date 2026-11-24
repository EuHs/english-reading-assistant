// SQLite storage (Node >= 22.13 built-in node:sqlite, no native build needed).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS articles(
    id INTEGER PRIMARY KEY, url TEXT UNIQUE, title TEXT, author TEXT, published_at TEXT, site TEXT, journal TEXT, doi TEXT,
    category TEXT, word_count INTEGER, reading_minutes INTEGER, first_read_at TEXT, last_read_at TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS words(
    id INTEGER PRIMARY KEY, lemma TEXT UNIQUE NOT NULL, phonetic TEXT, pos TEXT, translation TEXT, meaning TEXT,
    definitions TEXT, morphology TEXT, forms TEXT, tenses TEXT, etymology TEXT, enriched INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS word_forms(word_id INTEGER REFERENCES words(id) ON DELETE CASCADE, form TEXT, UNIQUE(word_id, form));
  CREATE TABLE IF NOT EXISTS occurrences(
    id INTEGER PRIMARY KEY, word_id INTEGER REFERENCES words(id) ON DELETE CASCADE, article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    surface TEXT, sentence TEXT, sentence_translation TEXT, meaning TEXT, source TEXT,
    created_at TEXT DEFAULT (datetime('now')), UNIQUE(word_id, article_id, sentence));
  CREATE TABLE IF NOT EXISTS roots(id INTEGER PRIMARY KEY, root TEXT UNIQUE, type TEXT, meaning TEXT, origin TEXT);
  CREATE TABLE IF NOT EXISTS word_roots(word_id INTEGER REFERENCES words(id) ON DELETE CASCADE, root_id INTEGER REFERENCES roots(id) ON DELETE CASCADE, UNIQUE(word_id, root_id));
  CREATE TABLE IF NOT EXISTS phrases(
    id INTEGER PRIMARY KEY, text TEXT, norm TEXT UNIQUE, kind TEXT, translation TEXT, note TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS phrase_occurrences(
    id INTEGER PRIMARY KEY, phrase_id INTEGER REFERENCES phrases(id) ON DELETE CASCADE, article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
    sentence TEXT, sentence_translation TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(phrase_id, article_id, sentence));
  CREATE TABLE IF NOT EXISTS quizzes(
    id INTEGER PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), finished_at TEXT, size INTEGER, category TEXT, root TEXT,
    mode TEXT, total INTEGER DEFAULT 0, correct INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS quiz_questions(
    id INTEGER PRIMARY KEY, quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE, idx INTEGER, word_id INTEGER REFERENCES words(id) ON DELETE CASCADE,
    type TEXT, prompt TEXT, hint TEXT, options TEXT, answer INTEGER, chosen INTEGER, correct INTEGER, answered_at TEXT);
  CREATE TABLE IF NOT EXISTS wrongbook(
    word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE, wrong_count INTEGER DEFAULT 0, right_streak INTEGER DEFAULT 0,
    last_wrong_at TEXT, mastered INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS word_reviews(
    word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE, stage INTEGER NOT NULL DEFAULT -1,
    due_at INTEGER NOT NULL, last_reviewed_at INTEGER, repetitions INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0, last_question_id INTEGER REFERENCES quiz_questions(id) ON DELETE SET NULL);
  CREATE TABLE IF NOT EXISTS context_studies(
    id INTEGER PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, topic TEXT NOT NULL, difficulty TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'generating', generation INTEGER NOT NULL DEFAULT 1, words TEXT NOT NULL,
    content TEXT, questions TEXT, reading_answers TEXT NOT NULL DEFAULT '[]', analysis_viewed INTEGER NOT NULL DEFAULT 0,
    source_quiz_id INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
    consolidation_quiz_id INTEGER UNIQUE REFERENCES quizzes(id) ON DELETE SET NULL,
    error TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT);
  CREATE INDEX IF NOT EXISTS idx_occ_word ON occurrences(word_id);
  CREATE INDEX IF NOT EXISTS idx_occ_article ON occurrences(article_id);
  CREATE INDEX IF NOT EXISTS idx_qq_quiz ON quiz_questions(quiz_id);
  CREATE INDEX IF NOT EXISTS idx_art_cat ON articles(category);
  CREATE INDEX IF NOT EXISTS idx_review_due ON word_reviews(due_at, word_id);
  `);
  // columns added after the first release (CREATE TABLE IF NOT EXISTS leaves existing tables as they were)
  for (const [table, col] of [['words', 'synonyms TEXT'], ['quizzes', 'types TEXT'], ['quiz_questions', 'review_revision INTEGER NOT NULL DEFAULT 0']]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col.split(' ')[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  }
  // Existing words start due; historical quiz scores do not establish spaced recall.
  db.prepare('INSERT OR IGNORE INTO word_reviews(word_id,due_at) SELECT id,? FROM words').run(Date.now());
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const J = {
  s: (v) => (v == null ? null : JSON.stringify(v)),
  p: (v, d = null) => { if (v == null || v === '') return d; try { return JSON.parse(v); } catch { return d; } },
};
