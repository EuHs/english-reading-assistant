// Business logic: vocab/phrase ingestion (lemma de-dup, roots, categories), queries, quiz, wrong book, stats.
import { tx, J } from './db.js';
import { lookup, canonicalLemma, guessCategory, CATEGORIES, dict } from './lexicon.js';

const now = () => new Date().toISOString();
const clip = (s, n) => (s == null ? '' : String(s).slice(0, n));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Service {
  constructor(db, ai) {
    this.db = db;
    this.ai = ai;
    this.queue = [];
    this.busy = false;
    this.dictPool = Object.keys(dict.words).filter((w) => w.length >= 4 && w.length <= 12 && /^[a-z]+$/.test(w));
  }

  /* ---------- articles & categories ---------- */
  upsertArticle(a) {
    if (!a || !a.url) a = { url: 'manual:' + (a && a.title ? a.title : 'unknown'), ...(a || {}) };
    const db = this.db;
    let row = db.prepare('SELECT * FROM articles WHERE url = ?').get(a.url);
    const cat = CATEGORIES.includes(a.category) ? a.category : null;
    if (!row) {
      const guess = cat || guessCategory([a.title, a.description, a.keywords, a.journal, a.site].join(' '));
      const r = db.prepare(`INSERT INTO articles(url,title,author,published_at,site,journal,doi,category,word_count,reading_minutes,first_read_at,last_read_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.url, clip(a.title, 300), clip(a.author, 300), clip(a.published_at, 40), clip(a.site, 120), clip(a.journal, 200),
        clip(a.doi, 120), guess, a.word_count || 0, a.reading_minutes || 0, a.read_at || now(), a.read_at || now());
      row = db.prepare('SELECT * FROM articles WHERE id = ?').get(r.lastInsertRowid);
      // AI refines the category when the client did not provide one
      if (!cat && this.ai.configured) this.enqueue(() => this.classifyArticle(row.id, a));
    } else {
      db.prepare(`UPDATE articles SET last_read_at=?, title=COALESCE(NULLIF(title,''),?), author=COALESCE(NULLIF(author,''),?),
        published_at=COALESCE(NULLIF(published_at,''),?), category=COALESCE(?,category), word_count=MAX(COALESCE(word_count,0),?),
        reading_minutes=MAX(COALESCE(reading_minutes,0),?) WHERE id=?`)
        .run(a.read_at || now(), clip(a.title, 300), clip(a.author, 300), clip(a.published_at, 40), cat, a.word_count || 0, a.reading_minutes || 0, row.id);
      row = db.prepare('SELECT * FROM articles WHERE id = ?').get(row.id);
    }
    return row;
  }

  async classifyArticle(id, a) {
    const c = await this.ai.classify(a, [a.description, a.keywords].filter(Boolean).join('\n'));
    if (c) this.db.prepare('UPDATE articles SET category=? WHERE id=?').run(c, id);
  }

  /* ---------- background AI queue (enrichment / classification) ---------- */
  enqueue(job) {
    this.queue.push(job);
    if (!this.busy) this.drain();
  }
  async drain() {
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      try { await job(); } catch (e) { console.warn('[ai-queue]', e.message); }
    }
    this.busy = false;
  }

  /* ---------- roots ---------- */
  normRoot(m) {
    const type = ['prefix', 'root', 'suffix'].includes(m.type) ? m.type : 'root';
    const variants = String(m.part || m.root || '').toLowerCase().split(/[,/|]/).map((v) => v.trim().replace(/\s+/g, '')).filter(Boolean);
    let k = variants[0];
    if (!k) return null;
    if (type === 'root') k = k.replace(/^-+|-+$/g, '');
    if (type === 'prefix' && !k.endsWith('-')) k += '-';
    if (type === 'suffix' && !k.startsWith('-')) k = '-' + k;
    const meaning = variants.length > 1 ? `${m.meaning || ''}（变体：${variants.join(', ')}）` : m.meaning;
    return { key: k, type, meaning: clip(meaning, 200), origin: clip(m.origin, 60) };
  }

  linkRoots(wordId, morphology) {
    const db = this.db;
    for (const m of morphology || []) {
      const r = this.normRoot(m);
      if (!r || r.key.length > 30) continue;
      db.prepare(`INSERT INTO roots(root,type,meaning,origin) VALUES(?,?,?,?)
        ON CONFLICT(root) DO UPDATE SET meaning=COALESCE(NULLIF(roots.meaning,''),excluded.meaning), origin=COALESCE(NULLIF(roots.origin,''),excluded.origin)`)
        .run(r.key, r.type, r.meaning, r.origin);
      const root = db.prepare('SELECT id FROM roots WHERE root=?').get(r.key);
      db.prepare('INSERT OR IGNORE INTO word_roots(word_id, root_id) VALUES(?,?)').run(wordId, root.id);
    }
  }

  /* ---------- words ---------- */
  addWord(p) {
    const word = String(p.word || '').trim().replace(/[^A-Za-z'’-]/g, '');
    if (!word) throw Object.assign(new Error('word 不能为空'), { status: 400 });
    const lemma = canonicalLemma(word, p.lemma);
    const d = lookup(lemma) || {};
    const db = this.db;
    const article = this.upsertArticle(p.article);
    let morphology = Array.isArray(p.morphology) && p.morphology.length ? p.morphology : [];
    if (Array.isArray(p.roots) && p.roots.length && !morphology.some((m) => m.type === 'root')) {
      morphology = morphology.concat(p.roots.map((r) => (typeof r === 'string' ? { part: r, type: 'root' } : r)));
    }
    if (!morphology.length && d.roots) morphology = d.roots;
    const result = tx(db, () => {
      let w = db.prepare('SELECT * FROM words WHERE lemma=?').get(lemma);
      const created = !w;
      if (!w) {
        const r = db.prepare(`INSERT INTO words(lemma,phonetic,pos,translation,meaning,definitions,morphology,forms,tenses,etymology,enriched)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(lemma, p.phonetic || d.phonetic || '', p.pos || '', p.translation || d.translation || '', p.meaning || '',
          J.s(p.definitions || []), J.s(morphology), J.s(p.forms || null), J.s(p.tenses || []), p.etymology || '', p.forms && p.tenses ? 1 : 0);
        w = db.prepare('SELECT * FROM words WHERE id=?').get(r.lastInsertRowid);
      } else {
        const oldMorph = J.p(w.morphology, []);
        db.prepare(`UPDATE words SET phonetic=COALESCE(NULLIF(phonetic,''),?), pos=COALESCE(NULLIF(pos,''),?), translation=COALESCE(NULLIF(translation,''),?),
          meaning=COALESCE(NULLIF(meaning,''),?), morphology=?, forms=COALESCE(forms,?), tenses=CASE WHEN tenses IS NULL OR tenses='[]' THEN ? ELSE tenses END,
          etymology=COALESCE(NULLIF(etymology,''),?), updated_at=datetime('now') WHERE id=?`)
          .run(p.phonetic || '', p.pos || '', p.translation || d.translation || '', p.meaning || '', J.s(morphology.length > oldMorph.length ? morphology : oldMorph),
            J.s(p.forms || null), J.s(p.tenses || []), p.etymology || '', w.id);
      }
      db.prepare('INSERT OR IGNORE INTO word_forms(word_id, form) VALUES(?,?)').run(w.id, word.toLowerCase());
      db.prepare(`INSERT OR IGNORE INTO occurrences(word_id,article_id,surface,sentence,sentence_translation,meaning,source) VALUES(?,?,?,?,?,?,?)`)
        .run(w.id, article.id, word, clip(p.sentence, 1500), clip(p.sentence_translation, 1500), clip(p.meaning, 300), clip(p.source, 30));
      this.linkRoots(w.id, morphology);
      return { id: w.id, lemma, created };
    });
    const w = db.prepare('SELECT enriched, forms FROM words WHERE id=?').get(result.id);
    if (!w.enriched && this.ai.configured) this.enqueue(() => this.enrich(result.id, word, p.sentence));
    return { ...result, article_id: article.id, category: article.category };
  }

  /** Re-queue words that were saved while AI was off or before a restart. */
  resumeEnrichment(limit = 200) {
    if (!this.ai.configured) return 0;
    const rows = this.db.prepare(`SELECT w.id, w.lemma, (SELECT sentence FROM occurrences WHERE word_id=w.id LIMIT 1) sentence
      FROM words w WHERE w.enriched=0 ORDER BY w.id LIMIT ?`).all(limit);
    for (const r of rows) this.enqueue(() => this.enrich(r.id, r.lemma, r.sentence || ''));
    return rows.length;
  }

  /** Server-side AI enrichment: roots (may be several), forms, tenses. */
  async enrich(id, word, sentence) {
    const a = await this.ai.word(word, sentence);
    const db = this.db;
    const w = db.prepare('SELECT * FROM words WHERE id=?').get(id);
    if (!w) return;
    const morph = Array.isArray(a.morphology) && a.morphology.length ? a.morphology : J.p(w.morphology, []);
    db.prepare(`UPDATE words SET phonetic=COALESCE(NULLIF(phonetic,''),?), pos=COALESCE(NULLIF(pos,''),?), meaning=COALESCE(NULLIF(meaning,''),?),
      definitions=?, morphology=?, forms=?, tenses=?, etymology=COALESCE(NULLIF(etymology,''),?), enriched=1, updated_at=datetime('now') WHERE id=?`)
      .run(a.phonetic || '', a.pos || '', a.meaning || '', J.s(a.definitions || []), J.s(morph), J.s(a.forms || null), J.s(a.tenses || []), a.etymology || '', id);
    tx(db, () => {
      // the AI's morphology replaces the offline root-table guess
      if (Array.isArray(a.morphology) && a.morphology.length) db.prepare('DELETE FROM word_roots WHERE word_id=?').run(id);
      this.linkRoots(id, morph.concat((a.roots || []).filter((r) => typeof r === 'string').map((r) => ({ part: r, type: 'root' }))));
    });
    db.prepare('DELETE FROM roots WHERE id NOT IN (SELECT root_id FROM word_roots)').run();
  }

  wordFilter({ q, category, root, article }) {
    const where = [], args = [];
    if (q) { where.push('(w.lemma LIKE ? OR w.meaning LIKE ? OR w.translation LIKE ? OR w.id IN (SELECT word_id FROM word_forms WHERE form LIKE ?))'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `${q}%`); }
    if (category) { where.push('w.id IN (SELECT o.word_id FROM occurrences o JOIN articles a ON a.id=o.article_id WHERE a.category=?)'); args.push(category); }
    if (root) { where.push('w.id IN (SELECT wr.word_id FROM word_roots wr JOIN roots r ON r.id=wr.root_id WHERE r.root=?)'); args.push(root); }
    if (article) { where.push('w.id IN (SELECT word_id FROM occurrences WHERE article_id=?)'); args.push(+article); }
    return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
  }

  listWords({ q, category, root, article, page = 1, size = 50, sort = 'new' } = {}) {
    const db = this.db;
    const f = this.wordFilter({ q, category, root, article });
    size = Math.min(500, Math.max(1, +size || 50));
    page = Math.max(1, +page || 1);
    const order = { new: 'w.created_at DESC, w.id DESC', alpha: 'w.lemma ASC', wrong: 'wb.wrong_count DESC NULLS LAST, w.id DESC', freq: 'occ DESC' }[sort] || 'w.id DESC';
    const total = db.prepare(`SELECT COUNT(*) n FROM words w ${f.sql}`).get(...f.args).n;
    const rows = db.prepare(`SELECT w.*, wb.wrong_count, (SELECT COUNT(*) FROM occurrences o WHERE o.word_id=w.id) occ
      FROM words w LEFT JOIN wrongbook wb ON wb.word_id=w.id ${f.sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...f.args, size, (page - 1) * size);
    return { total, page, size, items: rows.map((w) => this.decorate(w, false)) };
  }

  decorate(w, full) {
    const db = this.db;
    const out = {
      id: w.id, lemma: w.lemma, phonetic: w.phonetic, pos: w.pos, translation: w.translation, meaning: w.meaning,
      morphology: J.p(w.morphology, []), forms: J.p(w.forms), tenses: J.p(w.tenses, []), definitions: J.p(w.definitions, []),
      etymology: w.etymology, enriched: !!w.enriched, created_at: w.created_at, wrong_count: w.wrong_count || 0, occ: w.occ,
      roots: db.prepare('SELECT r.root, r.type, r.meaning, r.origin FROM word_roots wr JOIN roots r ON r.id=wr.root_id WHERE wr.word_id=?').all(w.id),
      categories: db.prepare('SELECT DISTINCT a.category FROM occurrences o JOIN articles a ON a.id=o.article_id WHERE o.word_id=? AND a.category IS NOT NULL').all(w.id).map((r) => r.category),
      forms_seen: db.prepare('SELECT form FROM word_forms WHERE word_id=?').all(w.id).map((r) => r.form),
    };
    const occSql = `SELECT o.surface, o.sentence, o.sentence_translation, o.meaning, o.created_at, a.id article_id, a.title, a.author, a.published_at, a.site, a.url, a.category, a.reading_minutes, a.word_count
      FROM occurrences o LEFT JOIN articles a ON a.id=o.article_id WHERE o.word_id=? ORDER BY o.created_at DESC`;
    out.occurrences = db.prepare(full ? occSql : occSql + ' LIMIT 2').all(w.id);
    if (full) {
      out.quiz = db.prepare('SELECT COUNT(*) total, SUM(correct) correct FROM quiz_questions WHERE word_id=? AND chosen IS NOT NULL').get(w.id);
    }
    return out;
  }

  getWord(id) {
    const w = this.db.prepare('SELECT w.*, wb.wrong_count FROM words w LEFT JOIN wrongbook wb ON wb.word_id=w.id WHERE w.id=?').get(+id);
    return w ? this.decorate(w, true) : null;
  }

  updateWord(id, p) {
    const fields = ['meaning', 'translation', 'phonetic', 'pos', 'etymology'].filter((k) => typeof p[k] === 'string');
    if (fields.length) this.db.prepare(`UPDATE words SET ${fields.map((k) => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`).run(...fields.map((k) => p[k]), +id);
    if (Array.isArray(p.morphology)) { this.db.prepare('UPDATE words SET morphology=? WHERE id=?').run(J.s(p.morphology), +id); this.db.prepare('DELETE FROM word_roots WHERE word_id=?').run(+id); this.linkRoots(+id, p.morphology); }
    return this.getWord(id);
  }

  deleteWord(id) { return this.db.prepare('DELETE FROM words WHERE id=?').run(+id).changes; }

  /** Cancel a saved word (bookmark-style). With article_url only that article's occurrences go; the word goes when none are left. */
  removeWordBy({ lemma, word, article_url } = {}) {
    const l = canonicalLemma(word || lemma, lemma);
    const db = this.db;
    const w = l && db.prepare('SELECT id FROM words WHERE lemma=?').get(l);
    if (!w) return { removed: null, lemma: l };
    if (article_url) {
      db.prepare('DELETE FROM occurrences WHERE word_id=? AND article_id IN (SELECT id FROM articles WHERE url=?)').run(w.id, article_url);
      const left = db.prepare('SELECT COUNT(*) n FROM occurrences WHERE word_id=?').get(w.id).n;
      if (left > 0) return { removed: 'occurrence', remaining: left, lemma: l };
    }
    db.prepare('DELETE FROM words WHERE id=?').run(w.id);
    return { removed: 'word', lemma: l };
  }

  /** none: not saved · other: saved from another article · here: saved from this article */
  bookStatus({ words = [], phrases = [], article_url } = {}) {
    const db = this.db;
    const state = (id, occTable, key) => {
      if (!id) return 'none';
      if (!article_url) return 'other';
      const hit = db.prepare(`SELECT 1 FROM ${occTable} o JOIN articles a ON a.id=o.article_id WHERE o.${key}=? AND a.url=? LIMIT 1`).get(id, article_url);
      return hit ? 'here' : 'other';
    };
    const out = { words: {}, phrases: {} };
    for (const w of words.slice(0, 200)) {
      const row = db.prepare('SELECT id, lemma FROM words WHERE lemma=?').get(canonicalLemma(w));
      out.words[w] = { state: state(row && row.id, 'occurrences', 'word_id'), lemma: row ? row.lemma : canonicalLemma(w) };
    }
    for (const t of phrases.slice(0, 200)) {
      const row = db.prepare('SELECT id FROM phrases WHERE norm=?').get(this.normPhrase(t));
      out.phrases[t] = { state: state(row && row.id, 'phrase_occurrences', 'phrase_id') };
    }
    return out;
  }

  /* ---------- phrases ---------- */
  addPhrase(p) {
    const text = String(p.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw Object.assign(new Error('text 不能为空'), { status: 400 });
    const norm = this.normPhrase(text);
    const db = this.db;
    const article = this.upsertArticle(p.article);
    return tx(db, () => {
      let ph = db.prepare('SELECT * FROM phrases WHERE norm=?').get(norm);
      if (!ph) {
        const r = db.prepare('INSERT INTO phrases(text,norm,kind,translation,note) VALUES(?,?,?,?,?)').run(text, norm, p.kind || 'phrase', p.translation || '', p.note || '');
        ph = { id: r.lastInsertRowid };
      } else db.prepare("UPDATE phrases SET translation=COALESCE(NULLIF(translation,''),?), note=COALESCE(NULLIF(note,''),?) WHERE id=?").run(p.translation || '', p.note || '', ph.id);
      db.prepare('INSERT OR IGNORE INTO phrase_occurrences(phrase_id,article_id,sentence,sentence_translation) VALUES(?,?,?,?)')
        .run(ph.id, article.id, clip(p.sentence, 2000), clip(p.sentence_translation, 2000));
      return { id: Number(ph.id), category: article.category };
    });
  }

  listPhrases({ q, category, kind, page = 1, size = 50 } = {}) {
    const where = [], args = [];
    if (q) { where.push('(p.text LIKE ? OR p.translation LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    if (kind) { where.push('p.kind=?'); args.push(kind); }
    if (category) { where.push('p.id IN (SELECT po.phrase_id FROM phrase_occurrences po JOIN articles a ON a.id=po.article_id WHERE a.category=?)'); args.push(category); }
    const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    size = Math.min(500, +size || 50);
    const total = this.db.prepare(`SELECT COUNT(*) n FROM phrases p ${sql}`).get(...args).n;
    const items = this.db.prepare(`SELECT p.* FROM phrases p ${sql} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args, size, (Math.max(1, +page) - 1) * size).map((p) => ({
      ...p,
      occurrences: this.db.prepare(`SELECT po.sentence, po.sentence_translation, po.created_at, a.title, a.author, a.published_at, a.site, a.url, a.category
        FROM phrase_occurrences po LEFT JOIN articles a ON a.id=po.article_id WHERE po.phrase_id=? ORDER BY po.id DESC`).all(p.id),
    }));
    return { total, items };
  }

  deletePhrase(id) { return this.db.prepare('DELETE FROM phrases WHERE id=?').run(+id).changes; }

  normPhrase(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[\s"'“”‘’.,;:!?]+$/g, '').replace(/^[\s"'“”‘’]+/, '');
  }

  removePhraseBy({ text, article_url } = {}) {
    const db = this.db;
    const p = db.prepare('SELECT id FROM phrases WHERE norm=?').get(this.normPhrase(text));
    if (!p) return { removed: null };
    if (article_url) {
      db.prepare('DELETE FROM phrase_occurrences WHERE phrase_id=? AND article_id IN (SELECT id FROM articles WHERE url=?)').run(p.id, article_url);
      const left = db.prepare('SELECT COUNT(*) n FROM phrase_occurrences WHERE phrase_id=?').get(p.id).n;
      if (left > 0) return { removed: 'occurrence', remaining: left };
    }
    db.prepare('DELETE FROM phrases WHERE id=?').run(p.id);
    return { removed: 'phrase' };
  }

  /* ---------- roots / articles / categories ---------- */
  listRoots({ q, type } = {}) {
    const where = [], args = [];
    if (q) { where.push('(r.root LIKE ? OR r.meaning LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    if (type) { where.push('r.type=?'); args.push(type); }
    return this.db.prepare(`SELECT r.*, COUNT(wr.word_id) words,
        (SELECT COALESCE(SUM(wb.wrong_count),0) FROM word_roots x JOIN wrongbook wb ON wb.word_id=x.word_id WHERE x.root_id=r.id) wrong
      FROM roots r JOIN word_roots wr ON wr.root_id=r.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY r.id ORDER BY words DESC, r.root`).all(...args);
  }

  listArticles() {
    return this.db.prepare(`SELECT a.*, (SELECT COUNT(DISTINCT word_id) FROM occurrences WHERE article_id=a.id) words,
      (SELECT COUNT(*) FROM phrase_occurrences WHERE article_id=a.id) phrases FROM articles a ORDER BY a.last_read_at DESC LIMIT 500`).all();
  }

  setArticleCategory(id, category) {
    if (category && !CATEGORIES.includes(category)) throw Object.assign(new Error('无效类别'), { status: 400 });
    this.db.prepare('UPDATE articles SET category=? WHERE id=?').run(category || null, +id);
  }

  categories() {
    const db = this.db;
    return CATEGORIES.map((c) => ({
      name: c,
      words: db.prepare('SELECT COUNT(DISTINCT o.word_id) n FROM occurrences o JOIN articles a ON a.id=o.article_id WHERE a.category=?').get(c).n,
      phrases: db.prepare('SELECT COUNT(DISTINCT po.phrase_id) n FROM phrase_occurrences po JOIN articles a ON a.id=po.article_id WHERE a.category=?').get(c).n,
      articles: db.prepare('SELECT COUNT(*) n FROM articles WHERE category=?').get(c).n,
    }));
  }

  /* ---------- quiz ---------- */
  shortMeaning(w) {
    let m = (w.meaning || '').trim();
    if (!m) m = String(w.translation || '').split('\n')[0];
    return m.replace(/\s+/g, ' ').slice(0, 48) || w.lemma;
  }

  startQuiz({ size = 20, category, root, mode = 'all' } = {}) {
    size = [20, 50, 80, 100].includes(+size) ? +size : Math.min(100, Math.max(1, +size || 20));
    const db = this.db;
    const f = this.wordFilter({ category, root });
    const extra = mode === 'wrong' ? `${f.sql ? 'AND' : 'WHERE'} w.id IN (SELECT word_id FROM wrongbook WHERE mastered=0)` : '';
    const pool = db.prepare(`SELECT w.* FROM words w ${f.sql} ${extra}`).all(...f.args);
    if (!pool.length) throw Object.assign(new Error(mode === 'wrong' ? '错题集为空' : '该范围内没有生词'), { status: 400 });
    const picked = shuffle(pool.slice()).slice(0, size);
    const all = db.prepare('SELECT id, lemma, meaning, translation FROM words').all();
    const sameCat = new Set(pool.map((w) => w.id));
    const quizId = tx(db, () => {
      const qid = db.prepare('INSERT INTO quizzes(size,category,root,mode,total) VALUES(?,?,?,?,?)').run(size, category || null, root || null, mode, picked.length).lastInsertRowid;
      picked.forEach((w, idx) => {
        const occ = db.prepare("SELECT surface, sentence, sentence_translation FROM occurrences WHERE word_id=? AND sentence<>'' ORDER BY RANDOM() LIMIT 1").get(w.id);
        const types = ['en2zh', 'zh2en'];
        if (occ && occ.sentence && new RegExp(`\\b${occ.surface.replace(/[^A-Za-z'-]/g, '')}\\b`, 'i').test(occ.sentence)) types.push('cloze');
        const type = types[Math.floor(Math.random() * types.length)];
        const q = this.buildQuestion(w, type, occ, all, sameCat);
        db.prepare('INSERT INTO quiz_questions(quiz_id,idx,word_id,type,prompt,hint,options,answer) VALUES(?,?,?,?,?,?,?,?)')
          .run(qid, idx, w.id, type, q.prompt, q.hint, J.s(q.options), q.answer);
      });
      return qid;
    });
    return this.getQuiz(quizId, false);
  }

  buildQuestion(w, type, occ, all, prefer) {
    const others = shuffle(all.filter((x) => x.id !== w.id && x.lemma !== w.lemma));
    others.sort((a, b) => (prefer.has(b.id) ? 1 : 0) - (prefer.has(a.id) ? 1 : 0));
    const pickTexts = (fn, correct) => {
      const out = [], seen = new Set([correct.toLowerCase()]);
      for (const o of others) { const t = fn(o); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); } if (out.length === 3) break; }
      while (out.length < 3) { // top up from the offline dictionary
        const lw = this.dictPool[Math.floor(Math.random() * this.dictPool.length)];
        const t = fn({ lemma: lw, translation: (dict.words[lw] || [])[1] || '' });
        if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
      }
      return out;
    };
    let prompt, hint = '', correct, distractors;
    if (type === 'en2zh') {
      prompt = w.lemma; hint = w.phonetic ? `/${w.phonetic}/` : '';
      correct = this.shortMeaning(w); distractors = pickTexts((o) => this.shortMeaning(o), correct);
    } else if (type === 'zh2en') {
      prompt = this.shortMeaning(w); correct = w.lemma; distractors = pickTexts((o) => o.lemma, correct);
    } else {
      const re = new RegExp(`\\b${occ.surface.replace(/[^A-Za-z'-]/g, '')}\\b`, 'i');
      prompt = occ.sentence.replace(re, '_____'); hint = occ.sentence_translation || ''; correct = occ.surface; distractors = pickTexts((o) => o.lemma, correct);
    }
    const options = shuffle([correct, ...distractors]);
    return { prompt, hint, options, answer: options.indexOf(correct) };
  }

  getQuiz(id, withAnswers) {
    const db = this.db;
    const quiz = db.prepare('SELECT * FROM quizzes WHERE id=?').get(+id);
    if (!quiz) return null;
    const qs = db.prepare('SELECT q.*, w.lemma, w.phonetic, w.meaning, w.translation FROM quiz_questions q JOIN words w ON w.id=q.word_id WHERE quiz_id=? ORDER BY idx').all(+id);
    const reveal = withAnswers || !!quiz.finished_at;
    quiz.questions = qs.map((q) => ({
      id: q.id, idx: q.idx, type: q.type, prompt: q.prompt, hint: q.hint, options: J.p(q.options, []), chosen: q.chosen, correct: q.correct == null ? null : !!q.correct,
      ...(reveal || q.chosen != null ? { answer: q.answer, word: { id: q.word_id, lemma: q.lemma, phonetic: q.phonetic, meaning: this.shortMeaning(q) } } : {}),
    }));
    return quiz;
  }

  answer(quizId, questionId, choice) {
    const db = this.db;
    const q = db.prepare('SELECT * FROM quiz_questions WHERE id=? AND quiz_id=?').get(+questionId, +quizId);
    if (!q) throw Object.assign(new Error('题目不存在'), { status: 404 });
    if (q.chosen != null) return { correct: !!q.correct, answer: q.answer, already: true };
    const ok = +choice === q.answer ? 1 : 0;
    tx(db, () => {
      db.prepare("UPDATE quiz_questions SET chosen=?, correct=?, answered_at=datetime('now') WHERE id=?").run(+choice, ok, q.id);
      db.prepare('UPDATE quizzes SET correct=correct+? WHERE id=?').run(ok, +quizId);
      if (!ok) {
        db.prepare(`INSERT INTO wrongbook(word_id,wrong_count,right_streak,last_wrong_at,mastered) VALUES(?,1,0,datetime('now'),0)
          ON CONFLICT(word_id) DO UPDATE SET wrong_count=wrong_count+1, right_streak=0, last_wrong_at=datetime('now'), mastered=0`).run(q.word_id);
      } else {
        // three correct answers in a row take a word out of the wrong book
        db.prepare('UPDATE wrongbook SET right_streak=right_streak+1, mastered=CASE WHEN right_streak+1>=3 THEN 1 ELSE mastered END WHERE word_id=?').run(q.word_id);
      }
    });
    const w = this.getWord(q.word_id);
    return { correct: !!ok, answer: q.answer, word: { id: w.id, lemma: w.lemma, phonetic: w.phonetic, meaning: this.shortMeaning(w), translation: w.translation, roots: w.roots, occurrences: w.occurrences.slice(0, 1) } };
  }

  finishQuiz(id) {
    const db = this.db;
    db.prepare("UPDATE quizzes SET finished_at=COALESCE(finished_at, datetime('now')) WHERE id=?").run(+id);
    const quiz = this.getQuiz(id, true);
    quiz.wrong = quiz.questions.filter((q) => q.correct === false || q.chosen == null).map((q) => ({ ...q, detail: this.getWord(q.word.id) }));
    return quiz;
  }

  listQuizzes() {
    return this.db.prepare('SELECT * FROM quizzes ORDER BY id DESC LIMIT 100').all();
  }

  wrongbook({ category, all } = {}) {
    const args = [];
    let sql = `SELECT w.*, wb.wrong_count, wb.right_streak, wb.last_wrong_at, wb.mastered,
      (SELECT COUNT(*) FROM quiz_questions q WHERE q.word_id=w.id AND q.chosen IS NOT NULL) attempts,
      (SELECT COALESCE(SUM(correct),0) FROM quiz_questions q WHERE q.word_id=w.id AND q.chosen IS NOT NULL) rights
      FROM wrongbook wb JOIN words w ON w.id=wb.word_id WHERE 1=1`;
    if (!all) sql += ' AND wb.mastered=0';
    if (category) { sql += ' AND w.id IN (SELECT o.word_id FROM occurrences o JOIN articles a ON a.id=o.article_id WHERE a.category=?)'; args.push(category); }
    return this.db.prepare(sql + ' ORDER BY wb.wrong_count DESC, wb.last_wrong_at DESC').all(...args).map((w) => ({ ...this.decorate(w, false), right_streak: w.right_streak, last_wrong_at: w.last_wrong_at, mastered: !!w.mastered, attempts: w.attempts, rights: w.rights }));
  }

  setMastered(wordId, mastered) {
    this.db.prepare('UPDATE wrongbook SET mastered=?, right_streak=CASE WHEN ? THEN right_streak ELSE 0 END WHERE word_id=?').run(mastered ? 1 : 0, mastered ? 1 : 0, +wordId);
  }

  /* ---------- statistics ---------- */
  stats() {
    const db = this.db;
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const totals = {
      words: one('SELECT COUNT(*) n FROM words').n,
      phrases: one('SELECT COUNT(*) n FROM phrases').n,
      articles: one('SELECT COUNT(*) n FROM articles').n,
      roots: one('SELECT COUNT(DISTINCT root_id) n FROM word_roots').n,
      quizzes: one('SELECT COUNT(*) n FROM quizzes').n,
      answers: one('SELECT COUNT(*) n FROM quiz_questions WHERE chosen IS NOT NULL').n,
      correct: one('SELECT COALESCE(SUM(correct),0) n FROM quiz_questions WHERE chosen IS NOT NULL').n,
      wrongWords: one('SELECT COUNT(*) n FROM wrongbook WHERE mastered=0').n,
      mastered: one('SELECT COUNT(*) n FROM wrongbook WHERE mastered=1').n,
    };
    totals.accuracy = totals.answers ? totals.correct / totals.answers : null;
    const byCategory = CATEGORIES.map((c) => {
      const r = one(`SELECT COUNT(*) answers, COALESCE(SUM(q.correct),0) correct FROM quiz_questions q
        WHERE q.chosen IS NOT NULL AND q.word_id IN (SELECT o.word_id FROM occurrences o JOIN articles a ON a.id=o.article_id WHERE a.category=?)`, c);
      const words = one('SELECT COUNT(DISTINCT o.word_id) n FROM occurrences o JOIN articles a ON a.id=o.article_id WHERE a.category=?', c).n;
      const wrongWords = one(`SELECT COUNT(*) n FROM wrongbook WHERE mastered=0 AND word_id IN (SELECT o.word_id FROM occurrences o JOIN articles a ON a.id=o.article_id WHERE a.category=?)`, c).n;
      return { category: c, words, answers: r.answers, correct: r.correct, wrong: r.answers - r.correct, wrongWords, accuracy: r.answers ? r.correct / r.answers : null };
    });
    const byWord = db.prepare(`SELECT w.id, w.lemma, w.meaning, w.translation, wb.wrong_count, wb.mastered,
        COUNT(q.id) attempts, COALESCE(SUM(q.correct),0) rights
      FROM wrongbook wb JOIN words w ON w.id=wb.word_id LEFT JOIN quiz_questions q ON q.word_id=w.id AND q.chosen IS NOT NULL
      GROUP BY w.id ORDER BY wb.wrong_count DESC, attempts DESC LIMIT 50`).all().map((r) => ({ ...r, meaning: this.shortMeaning(r), accuracy: r.attempts ? r.rights / r.attempts : null }));
    const byType = db.prepare(`SELECT type, COUNT(*) answers, COALESCE(SUM(correct),0) correct FROM quiz_questions WHERE chosen IS NOT NULL GROUP BY type`).all();
    const byRoot = db.prepare(`SELECT r.root, r.type, r.meaning, COUNT(DISTINCT wr.word_id) words, COALESCE(SUM(wb.wrong_count),0) wrong
      FROM roots r JOIN word_roots wr ON wr.root_id=r.id LEFT JOIN wrongbook wb ON wb.word_id=wr.word_id
      GROUP BY r.id ORDER BY wrong DESC, words DESC LIMIT 30`).all();
    const daily = db.prepare(`SELECT substr(answered_at,1,10) day, COUNT(*) answers, COALESCE(SUM(correct),0) correct FROM quiz_questions
      WHERE answered_at >= date('now','-30 day') GROUP BY day ORDER BY day`).all();
    const recent = db.prepare('SELECT * FROM quizzes ORDER BY id DESC LIMIT 10').all();
    return { totals, byCategory, byWord, byType, byRoot, daily, recent };
  }

  exportAll() {
    const db = this.db;
    const tables = ['articles', 'words', 'word_forms', 'occurrences', 'roots', 'word_roots', 'phrases', 'phrase_occurrences', 'quizzes', 'quiz_questions', 'wrongbook'];
    return { type: 'era-server-backup', exportedAt: now(), tables: Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()])) };
  }
}
