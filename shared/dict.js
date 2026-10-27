/* Offline dictionary (ECDICT subset) + lemmatizer + official word-root index. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.EXCHANGE_LABELS = { p: '过去式', d: '过去分词', i: '现在分词', 3: '第三人称单数', r: '比较级', t: '最高级', s: '复数', 0: '原形' };

ERA.parseExchange = function (ex) {
  const out = {};
  if (!ex) return out;
  for (const part of ex.split('/')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
};

/** Pure lookup on loaded data — used by background worker, userscript and server. */
ERA.dictLookup = function (dict, roots, raw) {
  if (!dict) return null;
  const word = String(raw).trim().replace(/[’]/g, "'").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
  if (!word) return null;
  const lower = word.toLowerCase();
  let lemma = dict.lemma[lower] || lower;
  // irregular chains: e.g. "better" -> "good"; guard against cycles
  for (let i = 0; i < 2 && dict.lemma[lemma] && dict.lemma[lemma] !== lemma; i++) lemma = dict.lemma[lemma];
  if (!dict.words[lemma] && dict.words[lower]) lemma = lower;
  if (!dict.words[lemma]) lemma = ERA.ruleLemma(lower, (w) => !!dict.words[w]) || lemma;
  const entry = dict.words[lower] || dict.words[lemma];
  const lemmaEntry = dict.words[lemma];
  const res = {
    word: word,
    lemma: lemma,
    found: !!entry,
    phonetic: entry ? entry[0] : '',
    translation: entry ? entry[1] : '',
    lemmaTranslation: lemmaEntry && lemma !== lower ? lemmaEntry[1] : '',
    exchange: ERA.parseExchange(lemmaEntry ? lemmaEntry[2] : entry ? entry[2] : ''),
    formOf: '',
    roots: [],
  };
  if (lemma !== lower) {
    const ex = res.exchange;
    const hit = Object.keys(ERA.EXCHANGE_LABELS).find((k) => k !== '0' && ex[k] && ex[k].split(',').includes(lower));
    res.formOf = `${lemma} 的${hit ? ERA.EXCHANGE_LABELS[hit] : '变形'}`;
  }
  if (roots) res.roots = ERA.rootLookup(roots, lemma);
  return res;
};

/** Root/affix analysis from the ECDICT wordroot list (Latin/Greek/OE roots). */
ERA.rootLookup = function (roots, lemma) {
  const keys = (roots.index[lemma] || []).slice();
  // keys can list spelling variants, e.g. "scrib,script" -> part "scrib", variants [scrib, script]
  return keys.map((k) => {
    const variants = k.split(',').map((v) => v.trim()).filter(Boolean);
    return { part: variants[0], variants, type: ERA.rootType(k, roots.roots[k]), meaning: roots.roots[k].m, origin: roots.roots[k].o };
  });
};

ERA.rootType = function (key, info) {
  const c = (info && info.c) || '';
  if (/prefix/i.test(c) || /-$/.test(key)) return 'prefix';
  if (/suffix/i.test(c) || /^-/.test(key)) return 'suffix';
  return 'root';
};

/** Fallback suffix stripping when the lemma table has no entry. */
ERA.ruleLemma = function (w, exists) {
  const rules = [
    [/ies$/, 'y'], [/ied$/, 'y'], [/ves$/, 'f'], [/ves$/, 'fe'], [/(ss|sh|ch|x|z|o)es$/, '$1'], [/s$/, ''],
    [/(.)\1ing$/, '$1'], [/ing$/, 'e'], [/ing$/, ''], [/(.)\1ed$/, '$1'], [/ed$/, 'e'], [/ed$/, ''],
    [/ier$/, 'y'], [/iest$/, 'y'], [/er$/, ''], [/est$/, ''], [/ly$/, ''],
  ];
  for (const [re, rep] of rules) {
    if (!re.test(w)) continue;
    const c = w.replace(re, rep);
    if (c.length > 1 && exists(c)) return c;
  }
  return null;
};
