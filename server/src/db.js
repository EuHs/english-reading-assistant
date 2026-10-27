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
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE INDEX IF NOT EXISTS idx_occ_word ON occurrences(word_id);
  CREATE INDEX IF NOT EXISTS idx_occ_article ON occurrences(article_id);
  CREATE INDEX IF NOT EXISTS idx_qq_quiz ON quiz_questions(quiz_id);
  CREATE INDEX IF NOT EXISTS idx_art_cat ON articles(category);
  `);
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
