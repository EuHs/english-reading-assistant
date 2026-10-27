/* Highlights / underlines / notes, persisted per page with text-quote anchors. */
var ERA = (globalThis.ERA = globalThis.ERA || {});

ERA.annotKey = null; // PDF reader sets this to the PDF url

ERA.Annot = {
  key() { return 'ann:' + (ERA.annotKey || ERA.cleanUrl(location.href)); },
  async list() { return (await ERA.P.getData(this.key(), [])) || []; },
  async save(list) { await ERA.P.setData(this.key(), list); },

  rootFor(node) {
    const el = node.nodeType === 3 ? node.parentNode : node;
    const tl = el && el.closest && el.closest('.textLayer');
    if (tl) return { root: tl, page: +tl.dataset.page || 0 };
    return { root: document.body, page: 0 };
  },

  textNodes(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentNode;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('.era-ui')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let pos = 0, n;
    while ((n = w.nextNode())) { out.push({ node: n, start: pos }); pos += n.nodeValue.length; }
    return { nodes: out, text: out.map((x) => x.node.nodeValue).join('') };
  },

  offsetOf(nodes, container, offset) {
    for (const x of nodes) if (x.node === container) return x.start + offset;
    // element container: offset is a child index
    if (container.nodeType === 1) {
      const child = container.childNodes[offset];
      for (const x of nodes) if (child ? child.contains(x.node) || child === x.node : container.contains(x.node)) return child ? x.start : x.start + x.node.nodeValue.length;
    }
    return -1;
  },

  anchor(range) {
    const { root, page } = this.rootFor(range.startContainer);
    const { nodes, text } = this.textNodes(root);
    const s = this.offsetOf(nodes, range.startContainer, range.startOffset);
    const e = this.offsetOf(nodes, range.endContainer, range.endOffset);
    if (s < 0 || e <= s) return null;
    return { page, pos: s, text: text.slice(s, e), prefix: text.slice(Math.max(0, s - 32), s), suffix: text.slice(e, e + 32) };
  },

  locate(root, a) {
    const { nodes, text } = this.textNodes(root);
    let idx = text.indexOf(a.prefix + a.text + a.suffix);
    if (idx >= 0) idx += a.prefix.length;
    else {
      let best = -1, bestD = Infinity, i = text.indexOf(a.text);
      while (i >= 0) { const d = Math.abs(i - (a.pos || 0)); if (d < bestD) { bestD = d; best = i; } i = text.indexOf(a.text, i + 1); }
      idx = best;
    }
    return idx < 0 ? null : { nodes, start: idx, end: idx + a.text.length };
  },

  wrap(nodes, start, end, ann) {
    const segs = [];
    for (const x of nodes) {
      const len = x.node.nodeValue.length;
      const s = Math.max(start, x.start), e = Math.min(end, x.start + len);
      if (e > s) segs.push([x.node, s - x.start, e - x.start]);
    }
    for (let [node, s, e] of segs) {
      if (!node.nodeValue.slice(s, e).trim() && segs.length > 1) continue;
      if (e < node.nodeValue.length) node.splitText(e);
      if (s > 0) node = node.splitText(s);
      const span = document.createElement('span');
      span.className = `era-mark era-${ann.type}`;
      if (ann.type === 'vocab' || ann.type === 'phrase') span.title = ann.type === 'vocab' ? '生词本 · 点击查看或取消' : '好词好句 · 点击查看或取消';
      span.dataset.eraId = ann.id;
      span.style.setProperty('--era-c', ERA.HIGHLIGHT_COLORS[ann.color] || ann.color || '#fde047');
      if (ann.note) span.title = ann.note;
      node.parentNode.insertBefore(span, node);
      span.appendChild(node);
    }
    const marks = document.querySelectorAll(`.era-mark[data-era-id="${ann.id}"]`);
    if (ann.note && marks.length) marks[marks.length - 1].classList.add('era-has-note');
  },

  unwrap(id) {
    document.querySelectorAll(`.era-mark[data-era-id="${id}"]`).forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
  },

  /** type: highlight | underline | note | vocab | phrase. extra.ref links vocab/phrase marks to the book entry. */
  async add(range, type, color, note, extra) {
    ERA.injectMarkStyle();
    const a = this.anchor(range);
    if (!a || !a.text.trim()) throw new Error('无法定位所选文本');
    const ann = { id: ERA.uid(), type, color: color || 'yellow', note: note || '', created: new Date().toISOString(), ...a, ...(extra || {}) };
    const { root } = this.rootFor(range.startContainer);
    const loc = this.locate(root, ann);
    if (loc) this.wrap(loc.nodes, loc.start, loc.end, ann);
    const list = await this.list();
    list.push(ann);
    await this.save(list);
    return ann;
  },

  async update(id, patch) {
    const list = await this.list();
    const ann = list.find((x) => x.id === id);
    if (!ann) return;
    Object.assign(ann, patch);
    await this.save(list);
    this.unwrap(id);
    const root = ann.page ? document.querySelector(`.textLayer[data-page="${ann.page}"]`) : document.body;
    const loc = root && this.locate(root, ann);
    if (loc) this.wrap(loc.nodes, loc.start, loc.end, ann);
  },

  async remove(id) {
    this.unwrap(id);
    await this.save((await this.list()).filter((x) => x.id !== id));
  },

  /** Remove the vocab/phrase marks that belong to one book entry on this page. */
  async removeByRef(type, ref) {
    const list = await this.list();
    const gone = list.filter((x) => x.type === type && x.ref === ref);
    gone.forEach((x) => this.unwrap(x.id));
    if (gone.length) await this.save(list.filter((x) => !gone.includes(x)));
    return gone.length;
  },

  /** Re-apply stored annotations. page=0 for HTML pages; a PDF page number for its text layer. */
  async restore(root, page) {
    ERA.injectMarkStyle();
    const list = (await this.list()).filter((x) => (x.page || 0) === (page || 0));
    for (const ann of list) {
      if (document.querySelector(`.era-mark[data-era-id="${ann.id}"]`)) continue;
      const loc = this.locate(root || document.body, ann);
      if (loc) this.wrap(loc.nodes, loc.start, loc.end, ann);
    }
  },
};

ERA.injectMarkStyle = function () {
  if (document.getElementById('era-mark-style')) return;
  const st = document.createElement('style');
  st.id = 'era-mark-style';
  st.textContent = `
  .era-mark{cursor:pointer;border-radius:2px}
  .era-highlight{background:color-mix(in srgb,var(--era-c) 70%,transparent)!important}
  .era-underline{text-decoration:underline 2px var(--era-c)!important;text-underline-offset:3px;border-bottom:2px solid var(--era-c)}
  .textLayer .era-underline{text-decoration:none!important}
  .era-note{background:color-mix(in srgb,var(--era-c) 35%,transparent)!important;border-bottom:2px dashed var(--era-c)}
  .era-has-note::after{content:"✎";font-size:10px;vertical-align:super;color:#d97706;opacity:1}
  .textLayer .era-has-note::after{color:#d97706}
  /* 生词 / 好词好句: drawn as a background image inside the text's own box, so nothing is
     inserted into the text, nothing changes layout and nothing paints over neighbouring lines */
  .era-vocab{background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2.2 Q1.5 0 3 2.2 T6 2.2' fill='none' stroke='%23e11d48' stroke-width='1.1'/%3E%3C/svg%3E") repeat-x left bottom/6px 3px!important;text-decoration:none!important}
  .era-phrase{background:linear-gradient(#7c3aed,#7c3aed) left calc(100% - 3px)/100% 1px no-repeat,linear-gradient(#7c3aed,#7c3aed) left bottom/100% 1px no-repeat!important;text-decoration:none!important}
  .era-vocab:hover{background-color:rgba(225,29,72,.12)!important}
  .era-phrase:hover{background-color:rgba(124,58,237,.12)!important}
  html.era-hide-book .era-vocab,html.era-hide-book .era-phrase{background:none!important;cursor:text}
  .era-flash{animation:era-flash 1.2s ease 2}
  @keyframes era-flash{50%{outline:3px solid #f59e0b}}`;
  (document.head || document.documentElement).appendChild(st);
};
