/* PDF study reader built on pdf.js (global pdfjsLib, v3 UMD build).
 * Used by the extension viewer page and the userscript overlay (mobile). */
var ERA = (globalThis.ERA = globalThis.ERA || {});

// The userscript opens the reader inside arbitrary websites, so the text layer resets inherited text styles
// (letter-spacing, padding …) that would otherwise misplace the invisible text over the drawn page.
ERA.READER_CSS = `
.era-reader{background:#525659;padding:12px 0 80px;min-height:100%}
.era-page{position:relative;margin:0 auto 14px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.era-page canvas{display:block;width:100%;height:100%}
.era-page .ph-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#999;font:14px sans-serif}
.textLayer{position:absolute;text-align:initial;inset:0;overflow:hidden;opacity:1;line-height:1;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:2}
.textLayer span:not(.era-mark),.textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}
.textLayer span:not(.era-mark){margin:0!important;padding:0!important;border:0!important;letter-spacing:normal!important;word-spacing:normal!important;text-transform:none!important;text-indent:0!important;font-weight:normal!important;font-style:normal!important;font-variant:normal!important;text-shadow:none!important}
.textLayer .era-mark{letter-spacing:inherit!important;word-spacing:inherit!important;text-transform:inherit!important;font-weight:inherit!important;font-style:inherit!important;margin:0!important;padding:0!important}
.textLayer span.markedContent{top:0;height:0}
.textLayer .era-mark{position:static;color:transparent}
.textLayer ::selection{background:rgba(37,99,235,.3)}
.textLayer br::selection{background:transparent}
.textLayer .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:-1;cursor:default;user-select:none}
.textLayer .endOfContent.active{top:0}`;

ERA.PdfReader = {
  pdf: null, scale: 1.4, container: null, observer: null, pages: [],

  injectStyle() {
    if (document.getElementById('era-reader-style')) return;
    const st = document.createElement('style');
    st.id = 'era-reader-style';
    st.textContent = ERA.READER_CSS;
    (document.head || document.documentElement).appendChild(st);
  },

  /** data: ArrayBuffer/Uint8Array. info: {url, name} */
  async open(container, data, info = {}) {
    this.injectStyle();
    ERA.injectMarkStyle();
    this.container = container;
    container.classList.add('era-reader');
    container.innerHTML = '<div style="color:#fff;text-align:center;padding:40px">正在解析 PDF…</div>';
    const pdf = await pdfjsLib.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false }).promise;
    this.pdf = pdf;
    const byteLen = data.byteLength;
    ERA.annotKey = info.url && !/^blob:/.test(info.url) ? ERA.cleanUrl(info.url) : `local:${info.name || 'file.pdf'}:${byteLen}`;
    // fit width on small screens
    const first = await pdf.getPage(1);
    const vw = Math.min(container.clientWidth || window.innerWidth, 1400) - 24;
    const base = first.getViewport({ scale: 1 });
    this.scale = Math.max(0.6, Math.min(2.2, vw / base.width));
    await this.buildMeta(pdf, first, info);
    this.layout();
    return pdf;
  },

  async buildMeta(pdf, first, info) {
    let md = {};
    try { md = (await pdf.getMetadata()).info || {}; } catch (e) { /* no metadata */ }
    const tc = await first.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim());
    const firstText = items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('');
    // Title fallback: the biggest text on page 1
    const size = (i) => Math.hypot(i.transform[2], i.transform[3]);
    const maxSize = Math.max(0, ...items.map(size));
    const bigTitle = items.filter((i) => size(i) >= maxSize * 0.92).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    const doi = (firstText.match(/\b10\.\d{4,9}\/[^\s"<>,;]+/) || [''])[0].replace(/[.)]+$/, '');
    const pub = firstText.match(/(?:Published(?: online)?|Accepted|Available online)[:\s]+(\d{1,2}\s+[A-Z][a-z]+\.?\s+\d{4}|[A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/);
    const title = (md.Title && md.Title.length > 3 && !/^(untitled|microsoft word|\S+\.(docx?|pdf))/i.test(md.Title) ? md.Title : bigTitle || info.name || 'PDF').slice(0, 300);
    let host = '本地 PDF';
    try { if (info.url && /^https?:/.test(info.url)) host = new URL(info.url).hostname; } catch (e) { /* ignore */ }
    ERA.pageMetaOverride = {
      url: ERA.annotKey, title, author: md.Author || '', published_at: ERA.normalizeDate(pub ? pub[1] : md.CreationDate || ''),
      site: host, journal: md.Subject && md.Subject.length < 120 ? md.Subject : '', doi, keywords: md.Keywords || '',
      description: firstText.slice(0, 400), word_count: 0, reading_minutes: 1, pages: pdf.numPages,
    };
    ERA.pageExcerpt = () => firstText.slice(0, 1500);
    document.title = title + ' · 英语阅读助手';
    this.countWords(pdf); // async, fills word_count/reading_minutes
  },

  async countWords(pdf) {
    let words = 0;
    const n = Math.min(pdf.numPages, 80);
    for (let p = 1; p <= n; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      words += (tc.items.map((i) => i.str).join(' ').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
    }
    if (pdf.numPages > n) words = Math.round((words / n) * pdf.numPages);
    if (ERA.pageMetaOverride) Object.assign(ERA.pageMetaOverride, { word_count: words, reading_minutes: Math.max(1, Math.round(words / 220)) });
  },

  async layout() {
    const pdf = this.pdf, c = this.container;
    c.innerHTML = '';
    if (this.observer) this.observer.disconnect();
    this.pages = [];
    const first = await pdf.getPage(1);
    const vp1 = first.getViewport({ scale: this.scale });
    for (let n = 1; n <= pdf.numPages; n++) {
      const div = document.createElement('div');
      div.className = 'era-page';
      div.dataset.page = n;
      div.style.width = vp1.width + 'px';
      div.style.height = vp1.height + 'px';
      div.innerHTML = `<div class="ph-label">第 ${n} 页</div>`;
      c.appendChild(div);
      this.pages.push({ n, div, rendered: false });
    }
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.renderPage(+e.target.dataset.page);
    }, { root: c.scrollHeight > c.clientHeight && getComputedStyle(c).overflowY !== 'visible' ? c : null, rootMargin: '1200px 0px' });
    this.pages.forEach((p) => this.observer.observe(p.div));
  },

  async renderPage(n) {
    const p = this.pages[n - 1];
    if (!p || p.rendered) return;
    p.rendered = true;
    const page = await this.pdf.getPage(n);
    const vp = page.getViewport({ scale: this.scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    p.div.style.width = vp.width + 'px';
    p.div.style.height = vp.height + 'px';
    p.div.style.setProperty('--scale-factor', vp.scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    const tl = document.createElement('div');
    tl.className = 'textLayer';
    tl.dataset.page = n;
    p.div.innerHTML = '';
    p.div.append(canvas, tl);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    const textDivs = [], textDivProperties = new WeakMap();
    const task = pdfjsLib.renderTextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp, textDivs, textDivProperties });
    await task.promise;
    this.fitTextLayer(p.div, textDivs, textDivProperties, vp.scale);
    const end = document.createElement('div');
    end.className = 'endOfContent';
    tl.appendChild(end);
    tl.addEventListener('mousedown', () => end.classList.add('active'));
    document.addEventListener('mouseup', () => end.classList.remove('active'));
    ERA.Annot.restore(tl, n).catch(() => {});
  },

  /**
   * pdf.js sizes each text span from an off-screen canvas measurement. When that font differs from the one the page
   * really renders (Safari's OffscreenCanvas, site CSS), lines are squeezed or stretched and a selection appears
   * shifted from the drawn words. Measure the real spans and correct their horizontal scale.
   */
  fitTextLayer(pageDiv, divs, props, scale) {
    const fix = divs.filter((d) => { const pr = props.get(d); return pr && pr.hasText && pr.canvasWidth > 0 && !pr.angle; });
    if (!fix.length) return;
    const local = pageDiv.offsetWidth / pageDiv.getBoundingClientRect().width || 1; // undo any ancestor zoom/transform
    fix.forEach((d) => { d.style.transform = 'none'; });
    const widths = fix.map((d) => d.getBoundingClientRect().width * local);
    fix.forEach((d, i) => { if (widths[i] > 0) d.style.transform = `scaleX(${(props.get(d).canvasWidth * scale) / widths[i]})`; });
  },

  zoom(f) {
    if (!this.pdf) return;
    this.scale = Math.max(0.5, Math.min(4, this.scale * f));
    this.layout();
  },

  goto(n) {
    const p = this.pages[n - 1];
    if (p) p.div.scrollIntoView({ block: 'start' });
  },
};
