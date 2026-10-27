// Build compact offline dictionary + word-root index from ECDICT (MIT).
// Usage: node tools/build-dict.mjs <ecdict_dir>
// Outputs:
//   dist/dict.json       { v, words:{w:[phonetic, translation, exchange]}, lemma:{inflection:lemma} }
//   dist/roots.json      { roots:{key:{m,c,o}}, index:{word:[key,...]} }
// Both files are copied into extension/data and (via tools/build.mjs) server/public/data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('usage: node tools/build-dict.mjs <ecdict_dir>'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function* parseCsv(text) {
  let i = 0, field = '', row = [], q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; yield row; row = [];
    } else field += c;
    i++;
  }
  if (field || row.length) { row.push(field); yield row; }
}

const MAX_RANK = 60000;
const csv = fs.readFileSync(path.join(src, 'ecdict.csv'), 'utf8');
const words = {};
const lemma = {};
let header = null, n = 0;
for (const r of parseCsv(csv)) {
  if (!header) { header = r; continue; }
  const [word, phonetic, , translation, , collins, oxford, tag, bnc, frq, exchange] = r;
  if (!word || !/^[A-Za-z][A-Za-z'-]*$/.test(word) || !translation) continue;
  const b = +bnc || 0, f = +frq || 0;
  const keep = tag || +collins > 0 || +oxford > 0 || (b > 0 && b <= MAX_RANK) || (f > 0 && f <= MAX_RANK);
  // Inflected forms point to their lemma even when the form itself is filtered out
  if (exchange) {
    const ex = Object.fromEntries(exchange.split('/').map((s) => [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)]));
    if (ex['0'] && ex['0'] !== word && /^[a-z'-]+$/i.test(ex['0'])) lemma[word.toLowerCase()] = ex['0'].toLowerCase();
    for (const k of ['p', 'd', 'i', '3', 's', 'r', 't']) {
      if (ex[k]) for (const form of ex[k].split(',')) if (form && form !== word) lemma[form.toLowerCase()] ??= word.toLowerCase();
    }
  }
  if (!keep) continue;
  const tr = translation.split('\\n').filter((l) => !l.startsWith('[网络]')).slice(0, 4).join('\\n').slice(0, 160);
  const key = word.toLowerCase();
  if (words[key] && word !== key) continue; // prefer lowercase entry
  words[key] = [phonetic || '', tr.replace(/\\n/g, '\n'), exchange || ''];
  n++;
}
// lemma.en.txt: "lemma/count -> form,form"
for (const line of fs.readFileSync(path.join(src, 'lemma.en.txt'), 'utf8').split('\n')) {
  if (!line || line[0] === ';') continue;
  const m = line.match(/^([^/]+)\/\d+\s*->\s*(.+)$/);
  if (!m) continue;
  const base = m[1].trim().toLowerCase();
  if (!/^[a-z-]+$/.test(base)) continue;
  for (const f of m[2].split(',')) {
    const form = f.trim().toLowerCase();
    if (form && form !== base && /^[a-z-]+$/.test(form) && !['it', 'he', 'i', 'they', 'you', 'she'].includes(base)) lemma[form] ??= base;
  }
}
for (const k of Object.keys(lemma)) if (lemma[k] === k) delete lemma[k];

const rootsRaw = JSON.parse(fs.readFileSync(path.join(src, 'wordroot.txt'), 'utf8'));
const roots = {}, index = {};
for (const [key, v] of Object.entries(rootsRaw)) {
  roots[key] = { m: v.meaning || '', c: v.class || '', o: v.origin || '' };
  for (const ex of v.example || []) {
    const w = ex.toLowerCase().trim();
    if (!/^[a-z-]+$/.test(w)) continue;
    (index[w] ??= []).includes(key) || index[w].push(key);
  }
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dict = JSON.stringify({ v: 1, words, lemma });
const rootJson = JSON.stringify({ roots, index });
for (const dir of ['dist', 'extension/data']) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, 'dict.json'), dict);
  fs.writeFileSync(path.join(root, dir, 'roots.json'), rootJson);
}
console.log(`words=${n} lemma=${Object.keys(lemma).length} roots=${Object.keys(roots).length} indexed=${Object.keys(index).length}`);
console.log(`dict.json ${(dict.length / 1e6).toFixed(1)}MB, roots.json ${(rootJson.length / 1e6).toFixed(2)}MB`);
