/* Article metadata + sentence extraction. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.pageMetaOverride = null; // PDF reader sets this from PDF metadata

ERA.extractMeta = function (doc) {
  doc = doc || document;
  const metaVals = (names) => {
    const out = [];
    for (const n of names) {
      doc.querySelectorAll(`meta[name="${n}" i], meta[property="${n}" i], meta[itemprop="${n}" i]`).forEach((m) => {
        const v = (m.getAttribute('content') || '').trim();
        if (v && !out.includes(v)) out.push(v);
      });
    }
    return out;
  };
  const ld = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const j = JSON.parse(s.textContent);
      const flat = (x) => (Array.isArray(x) ? x.flatMap(flat) : x && x['@graph'] ? flat(x['@graph']) : x ? [x] : []);
      ld.push(...flat(j));
    } catch (e) { /* ignore */ }
  });
  const article = ld.find((x) => /Article|Report|Posting|ScholarlyArticle|BlogPosting/i.test([].concat(x['@type'] || '').join(','))) || {};
  const ldAuthor = [].concat(article.author || []).map((a) => (typeof a === 'string' ? a : a && a.name)).filter(Boolean);
  const byline = Array.from(doc.querySelectorAll('[rel="author"], [itemprop="author"], .byline__name, .author-name, .byline, .author'))
    .map((e) => e.textContent.trim().replace(/^by\s+/i, ''))
    .filter((t) => t && t.length < 80);
  const timeEl = doc.querySelector('article time[datetime], time[datetime]');
  const title =
    metaVals(['citation_title', 'dc.title'])[0] || article.headline || metaVals(['og:title', 'twitter:title'])[0] ||
    (doc.querySelector('h1') && doc.querySelector('h1').textContent.trim()) || doc.title;
  const authors = metaVals(['citation_author', 'dc.creator']).length ? metaVals(['citation_author', 'dc.creator'])
    : ldAuthor.length ? ldAuthor : metaVals(['author', 'article:author', 'parsely-author', 'sailthru.author']).length
    ? metaVals(['author', 'article:author', 'parsely-author', 'sailthru.author']) : byline.slice(0, 3);
  const published =
    metaVals(['citation_publication_date', 'citation_date', 'citation_online_date', 'article:published_time', 'dc.date', 'pubdate', 'publishdate', 'date', 'og:article:published_time'])[0] ||
    article.datePublished || (timeEl && timeEl.getAttribute('datetime')) || '';
  const text = ERA.mainText(doc);
  const words = (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
  const meta = {
    url: ERA.cleanUrl(location.href),
    title: (title || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    author: authors.filter((a) => !/^https?:/.test(a)).join(', ').slice(0, 300),
    published_at: ERA.normalizeDate(published),
    site: metaVals(['og:site_name', 'citation_journal_title', 'citation_publisher'])[0] || location.hostname,
    journal: metaVals(['citation_journal_title'])[0] || '',
    doi: metaVals(['citation_doi', 'dc.identifier'])[0] || '',
    description: (metaVals(['description', 'og:description'])[0] || '').slice(0, 500),
    keywords: (metaVals(['keywords', 'citation_keywords', 'news_keywords'])[0] || '').slice(0, 300),
    word_count: words,
    reading_minutes: Math.max(1, Math.round(words / 220)),
    read_at: new Date().toISOString(),
    lang: doc.documentElement.lang || '',
  };
  return ERA.pageMetaOverride ? { ...meta, ...ERA.pageMetaOverride, read_at: meta.read_at } : meta;
};

ERA.mainText = function (doc) {
  const el = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.body;
  return el ? el.innerText || el.textContent || '' : '';
};

ERA.cleanUrl = function (u) {
  try {
    const url = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'spm'].forEach((k) => url.searchParams.delete(k));
    url.hash = '';
    return url.toString();
  } catch (e) { return u; }
};

ERA.normalizeDate = function (s) {
  if (!s) return '';
  s = String(s).trim();
  const pdf = s.match(/^D:(\d{4})(\d{2})?(\d{2})?/); // PDF date format
  if (pdf) return [pdf[1], pdf[2] || '01', pdf[3] || '01'].join('-');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, '$1-$2-$3'));
  // local calendar date (toISOString would shift "12 March 2024" to the 11th east of UTC)
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const y = s.match(/\b(19|20)\d{2}\b/);
  return y ? y[0] : s.slice(0, 30);
};

ERA.BLOCK_SEL = 'p,li,td,th,dd,dt,blockquote,h1,h2,h3,h4,h5,h6,figcaption,pre,section,article,div,.textLayer';

/** Walk a block's text, inserting spaces at <br> / between PDF text-layer spans; return text and selection offsets. */
ERA.blockText = function (block, range) {
  let text = '', start = -1, end = -1;
  const isPdf = block.classList && block.classList.contains('textLayer');
  const walk = (node) => {
    if (node.nodeType === 3) {
      if (range && node === range.startContainer) start = text.length + range.startOffset;
      if (range && node === range.endContainer) end = text.length + range.endOffset;
      text += node.nodeValue;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || (node.classList && node.classList.contains('era-ui'))) return;
    if (tag === 'BR') { if (!/\s$/.test(text)) text += ' '; return; }
    const kids = node.childNodes;
    for (let i = 0; i <= kids.length; i++) {
      if (range && node === range.startContainer && i === range.startOffset) start = text.length;
      if (range && node === range.endContainer && i === range.endOffset) end = text.length;
      if (i < kids.length) walk(kids[i]);
    }
    if (isPdf && tag === 'SPAN' && !/\b(era-mark|markedContent)\b/.test(node.className) && !node.closest('.era-mark') && text && !/[\s-]$/.test(text)) text += ' ';
  };
  walk(block);
  return { text, start, end };
};

/** Find the full sentence that contains the current selection. */
ERA.sentenceFromRange = function (range) {
  if (!range) return '';
  let node = range.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  let block = node.closest ? node.closest(ERA.BLOCK_SEL) : null;
  // tiny inline divs: climb until the block has some length
  while (block && block.parentElement && (block.innerText || block.textContent || '').length < 40 && !block.classList.contains('textLayer')) {
    const up = block.parentElement.closest(ERA.BLOCK_SEL);
    if (!up) break;
    block = up;
  }
  if (!block) return range.toString();
  const { text, start, end } = ERA.blockText(block, range);
  if (start < 0) return range.toString().trim();
  return ERA.sentenceAt(text, start, end < 0 ? start : end);
};

ERA.ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|Figs|No|Vol|Inc|Ltd|Co|Corp|U\.S|U\.K|al|approx|Eq|Ref|Refs)\.$/i;

ERA.sentenceAt = function (text, start, end) {
  const isBoundary = (i) => {
    // text[i] is terminal punctuation and next char is space/quote/end
    const ch = text[i];
    if (!/[.!?。！？]/.test(ch)) return false;
    if (/[。！？]/.test(ch)) return true;
    const next = text.slice(i + 1, i + 3);
    if (next && !/^["'”’)\]]?(\s|$)/.test(next)) return false;
    if (ch === '.' && ERA.ABBR.test(text.slice(Math.max(0, i - 6), i + 1))) return false;
    if (ch === '.' && /\b[A-Z]$/.test(text.slice(Math.max(0, i - 2), i))) return false; // initials "J. Smith"
    return true;
  };
  let s = start;
  while (s > 0 && !isBoundary(s - 1)) s--;
  let e = Math.max(end, start);
  while (e < text.length && !isBoundary(e)) e++;
  if (e < text.length) e++;
  while (e < text.length && /["'”’)\]]/.test(text[e])) e++;
  return text.slice(s, e).replace(/\s+/g, ' ').trim().slice(0, 1500);
};
