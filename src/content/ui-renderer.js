/**
 * UiRenderer — evidenziazione degli errori pinyin + popup UNICO.
 * NON tocca mai il DOM dei campi editabili: usa un overlay speculare
 * (stesso font/padding, testo trasparente, sottolineatura rossa) sopra il
 * campo, con pointer-events:none. In questo modo la digitazione resta
 * naturale.
 *
 * Il popup unico (.pc-pop) ha tre stati MUTUALMENTE ESCLUSIVI (mai
 * sovrapposti), con priorità:
 *   1. suggest  — suggerimenti IME (mentre scrivi, tasti 1-9)
 *   2. errors   — riepilogo errori + Ignora/Ok + azioni (Converti/Aggiungi)
 *   3. lookup   — traduzione su selezione di testo nella pagina
 * Espone globalmente `PinynUi`.
 */
(function (root) {
  'use strict';

  const NS = 'pc-';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------------
  // Overlay speculare (condiviso tra textarea/input e contenteditable)
  // ------------------------------------------------------------------
  function createMirrorOverlay(element) {
    const style = window.getComputedStyle(element);
    const overlay = document.createElement('div');
    overlay.className = NS + 'overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const code = document.createElement('div');
    code.className = NS + 'overlay-content';
    overlay.appendChild(code);

    overlay.style.cssText = [
      'position:absolute',
      'box-sizing:border-box',
      'padding:' + style.padding,
      'border:' + style.borderWidth + ' solid transparent',
      'font:' + style.font,
      'fontSize:' + style.fontSize,
      'lineHeight:' + style.lineHeight,
      'letterSpacing:' + style.letterSpacing,
      'wordSpacing:' + style.wordSpacing,
      'text-align:left',
      'white-space:pre-wrap',
      'word-wrap:break-word',
      'overflow:hidden',
      'color:transparent',
      'pointer-events:none',
      'z-index:0',
    ].join(';');

    document.body.appendChild(overlay);

    function place() {
      const rect = element.getBoundingClientRect();
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      overlay.style.scrollTop = element.scrollTop;
    }

    function getText() {
      return element.innerText != null ? element.innerText : (element.textContent || '');
    }

    function render(entries) {
      if (!pluginEnabled) { code.innerHTML = ''; place(); return; }
      const text = getText();
      let i = 0;
      const parts = [];
      for (const e of entries) {
        if (e.start > i) parts.push(escapeHtml(text.slice(i, e.start)));
        const seg = escapeHtml(text.slice(e.start, e.end));
        const isTone = e.kind === 'tone';
        const title = isTone
          ? 'Tono sospetto: ' + (e.suggestions.join(', ') || 'controlla il tono')
          : (e.suggestions.length ? 'Pinyin: ' + e.suggestions.join(', ') : 'Pinyin sconosciuto');
        parts.push(
          '<mark class="' + NS + (isTone ? 'susp' : 'err') + '" title="' + title + '">' + seg + '</mark>'
        );
        i = Math.max(i, e.end);
      }
      if (i < text.length) parts.push(escapeHtml(text.slice(i)));
      code.innerHTML = parts.join('');
      place();
    }

    function handleScroll() {
      code.style.marginTop = -overlay.scrollTop + 'px';
      code.style.marginLeft = -overlay.scrollLeft + 'px';
    }
    element.addEventListener('scroll', handleScroll);
    overlay.addEventListener('wheel', (e) => e.preventDefault());

    function show() { overlay.style.visibility = 'visible'; }
    function hide() { overlay.style.visibility = 'hidden'; }
    element.addEventListener('focus', show);
    element.addEventListener('blur', hide);

    function onPageMove() { place(); }
    window.addEventListener('scroll', onPageMove, true);
    window.addEventListener('resize', onPageMove);

    if (element === document.activeElement) show(); else hide();

    return {
      render,
      place,
      show,
      hide,
      destroy() {
        overlay.remove();
        element.removeEventListener('scroll', handleScroll);
        element.removeEventListener('focus', show);
        element.removeEventListener('blur', hide);
        window.removeEventListener('scroll', onPageMove, true);
        window.removeEventListener('resize', onPageMove);
      },
    };
  }

  // ------------------------------------------------------------------
  // Sostituzione testo per contenteditable (Range su text node)
  // ------------------------------------------------------------------
  function textNodeAtOffset(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let n = walker.nextNode();
    if (!n) return null;
    do {
      const len = n.nodeValue.length;
      if (remaining <= len) return { node: n, offset: remaining };
      remaining -= len;
    } while ((n = walker.nextNode()));
    return null;
  }

  function replaceInContentEditable(el, start, end, replacement) {
    const a = textNodeAtOffset(el, start);
    const b = textNodeAtOffset(el, end);
    if (!a || !b) return;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    range.collapse(false);
    el.normalize();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Converte i toni numerici (ni3 -> nǐ) applicando le sostituzioni in
   * ordine inverso (gli offset restano validi).
   */
  function convertTonesIn(field, applyReplace) {
    const text = field.value != null ? field.value : (field.textContent || '');
    const tokens = root.PinynUtils.tokenize(text);
    const edits = [];
    let offset = 0;
    for (const t of tokens) {
      const start = offset;
      const end = offset + t.text.length;
      offset = end;
      if (!t.isLatin) continue;
      const m = t.text.match(/^([a-zü]+)([0-5])$/);
      if (!m) continue;
      const repl = root.PinynUtils.toToneMark(m[1] + m[2]);
      if (repl !== t.text) edits.push({ start, end, repl });
    }
    for (let i = edits.length - 1; i >= 0; i--) {
      applyReplace(edits[i].start, edits[i].end, edits[i].repl);
    }
    return edits.length;
  }

  /**
   * Accentua i token pinyin senza accento usando il dizionario (parole HSK
   * o tono più frequente). Le parole riconosciute vengono unite senza spazi
   * (zhong guo -> zhōngguó). Le sostituzioni sono lunghezza-preservanti.
   */
  function applyAccentsIn(field, engine, applyReplace) {
    if (!pluginEnabled) return 0;
    const text = field.value != null ? field.value : (field.textContent || '');
    const tokens = root.PinynUtils.tokenize(text);
    const edits = [];
    let offset = 0;
    let i = 0;
    while (i < tokens.length) {
      if (!tokens[i].isLatin) {
        offset += tokens[i].text.length;
        i++;
        continue;
      }
      // raggruppa sillabe latine separate da spazi (possibile parola unica)
      const group = [];
      let j = i;
      while (j < tokens.length && (tokens[j].isLatin || /^\s+$/.test(tokens[j].text))) {
        group.push(tokens[j]);
        j++;
      }
      let to = offset;
      for (const t of group) { t.__s = to; t.__e = to + t.text.length; to = t.__e; }

      const latins = group.filter((t) => t.isLatin);
      const bares = latins.map((t) => root.PinynUtils.stripTone(t.text));
      const allAccentable = latins.every(
        (t) => !root.PinynUtils.isToneNumbered(t.text) && !root.PinynUtils.hasToneMark(t.text)
      );

      if (allAccentable) {
        const segments = engine.accentRun(bares);
        let ti = 0;
        for (const seg of segments) {
          const start = latins[ti].__s;
          const end = latins[ti + seg.count - 1].__e;
          const orig = text.slice(start, end);
          if (seg.text !== orig) edits.push({ start, end, repl: seg.text });
          ti += seg.count;
        }
      } else {
        latins.forEach((t, k) => {
          if (root.PinynUtils.isToneNumbered(t.text) || root.PinynUtils.hasToneMark(t.text)) return;
          const acc = engine.accentSingle(bares[k]);
          if (acc && acc !== t.text) edits.push({ start: t.__s, end: t.__e, repl: acc });
        });
      }
      offset = to;
      i = j;
    }
    for (let k = edits.length - 1; k >= 0; k--) {
      applyReplace(edits[k].start, edits[k].end, edits[k].repl);
    }
    return edits.length;
  }

  /**
   * Conversione batch pinyin -> caratteri cinesi (intero campo).
   * Riusa la segmentazione di accentRun; ogni segmento viene mappato al
   * carattere più comune tramite lookupDef (__PINYN_DEFS). I segmenti senza
   * match restano invariati.
   */
  function applyHanziIn(field, engine, applyReplace) {
    if (!pluginEnabled) return 0;
    const text = field.value != null ? field.value : (field.textContent || '');
    const tokens = root.PinynUtils.tokenize(text);
    const edits = [];
    let offset = 0;
    let i = 0;
    while (i < tokens.length) {
      if (!tokens[i].isLatin) {
        offset += tokens[i].text.length;
        i++;
        continue;
      }
      const group = [];
      let j = i;
      while (j < tokens.length && (tokens[j].isLatin || /^\s+$/.test(tokens[j].text))) {
        group.push(tokens[j]);
        j++;
      }
      let to = offset;
      for (const t of group) { t.__s = to; t.__e = to + t.text.length; to = t.__e; }
      const latins = group.filter((t) => t.isLatin);
      const bares = latins.map((t) => root.PinynUtils.stripTone(t.text));
      const segments = engine.accentRun(bares);
      let ti = 0;
      for (const seg of segments) {
        const start = latins[ti].__s;
        const end = latins[ti + seg.count - 1].__e;
        let d = null;
        if (seg.count === 1) {
          d = hanziForTone(seg.text); // sillaba singola: hanzi per TONO (是 vs 十)
        }
        if (!d) {
          const segBare = root.PinynUtils.stripTone(seg.text).replace(/\s+/g, '');
          d = lookupDef(segBare);
        }
        if (d && d.hanzi && d.hanzi !== text.slice(start, end)) {
          edits.push({ start, end, repl: d.hanzi });
        }
        ti += seg.count;
      }
      offset = to;
      i = j;
    }
    for (let k = edits.length - 1; k >= 0; k--) {
      applyReplace(edits[k].start, edits[k].end, edits[k].repl);
    }
    return edits.length;
  }
  // ------------------------------------------------------------------
  let active = null;        // handle del campo attivo
  let currentEngine = null; // ultimo engine usato (lookup/reverse)
  let insertHanzi = false;  // opzione: accetta come caratteri cinesi
  let pluginEnabled = true; // toggle "Abilitato" dal gadget
  let checkForm = true;     // verifica grammaticale (regole + LM)
  let spaceAfterAccept = false; // spazio dopo il suggerimento accettato
  let translateEnabled = true;  // traduzione automatica sulla selezione
  let translateLang = 'it';     // lingua di destinazione (es. "it", "zh-CN")
  let translateMaxLen = 500;    // limite caratteri tradotti sulla selezione
  let translateSeq = 0;         // token per scartare traduzioni in ritardo
  let lastTypingAt = 0;         // timestamp ultimo input (per non coprire mentre si digita)
  let suggestTimer = null;      // debounce dei suggerimenti IME
  let suppressWord = null;      // parola appena accettata: non riproporla

  function setEnabled(v) {
    pluginEnabled = !!v;
    if (!pluginEnabled) hidePop();
  }

  function setTranslate(v, lang, maxLen) {
    translateEnabled = !!v;
    if (/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(lang || ''))) translateLang = lang;
    const n = Number(maxLen);
    if (n >= 1 && n <= 2000) translateMaxLen = n;
  }

  // ------------------------------------------------------------------
  // Lookup traduzioni (window.__PINYN_DEFS / __PINYN_HSK)
  // ------------------------------------------------------------------
  let hanziToPinyin = null;
  function lookupDef(bareOrAccented) {
    const defs = root.__PINYN_DEFS;
    if (!defs) return null;
    const bare = root.PinynUtils.stripTone(bareOrAccented).replace(/\s+/g, '');
    const v = defs[bare];
    if (!v) return null;
    const i = v.indexOf('|');
    return { hanzi: i >= 0 ? v.slice(0, i) : v, gloss: i >= 0 ? v.slice(i + 1) : '' };
  }

  function pinyinForHanzi(hanzi) {
    if (!root.__PINYN_HSK) return null;
    if (!hanziToPinyin) {
      hanziToPinyin = new Map();
      for (const w of root.__PINYN_HSK) if (!hanziToPinyin.has(w.w)) hanziToPinyin.set(w.w, w.p);
    }
    for (let len = hanzi.length; len >= 1; len--) {
      const w = hanziToPinyin.get(hanzi.slice(0, len));
      if (w) return { word: hanzi.slice(0, len), pinyin_numbers: w };
    }
    return null;
  }

  // ---------- hanzi TONO-aware per sillabe singole ----------
  // (bare+tone -> carattere singolo più comune; 是=shi4, 十=shi2)
  const TONE_HANZI_OVERRIDE = {
    shi4: '是', // to be (la ranking generico metterebbe 事)
  };
  let bareToneHanzi = null;
  let syllableSet = null;
  function ensureSyllableSet() {
    if (syllableSet) return syllableSet;
    syllableSet = new Set(root.__PINYN_SYLLABLES || []);
    return syllableSet;
  }
  function ensureBareToneHanzi() {
    if (bareToneHanzi) return bareToneHanzi;
    bareToneHanzi = new Map();
    const list = root.__PINYN_HSK;
    if (!list) return bareToneHanzi;
    for (const w of list) {
      if (w.w.length !== 1) continue;
      const nums = (w.p || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (nums.length !== 1) continue;
      const m = nums[0].match(/^([a-zü]+)([0-5])$/);
      if (!m) continue;
      const key = m[1] + (m[2] === '0' || m[2] === '5' ? '0' : m[2]);
      const cur = bareToneHanzi.get(key);
      if (!cur || (w.l || 9) < cur.l) bareToneHanzi.set(key, { hanzi: w.w, l: w.l || 9 });
    }
    return bareToneHanzi;
  }

  /** Hanzi per una sillaba ACCENTATA singola (es. "shì" -> 是). */
  function hanziForTone(text) {
    if (!text) return null;
    const e = root.PinynUtils.extractTone(text);
    const key = e.base.replace(/\s+/g, '') + (e.tone > 0 ? e.tone : '0');
    let hit = TONE_HANZI_OVERRIDE[key];
    if (!hit) hit = ensureBareToneHanzi().get(key);
    if (hit) {
      const hanzi = typeof hit === 'string' ? hit : hit.hanzi;
      let gloss = '';
      // gloss solo se il defs della sillaba nuda corrisponde a QUESTO hanzi
      // (evita di attribuire a hé il gloss di 喝: defs[he]=喝|to drink)
      const d = lookupDef(text);
      if (d && d.hanzi === hanzi) gloss = d.gloss;
      return { hanzi, gloss };
    }
    // Sillaba singola senza carattere tono-specifico: NIENTE fallback al defs
    // (è tone-agnostico e abbinerebbe il tono sbagliato, es. hè -> 喝).
    const bare = root.PinynUtils.stripTone(text).replace(/\s+/g, '');
    if (ensureSyllableSet().has(bare)) return null;
    return lookupDef(text);
  }

  function levelOfWord(word) {
    const list = root.__PINYN_HSK;
    if (!list) return null;
    for (const w of list) if (w.w === word) return w.l;
    return null;
  }

  function levelLabel(l) {
    if (l == null) return '?';
    return l === 7.5 ? '7-9' : String(l);
  }

  // ---------- reverse dizionario (parola inglese -> cinese) ----------
  const GLOSS_STOP = new Set(
    ('to of and or the a an in at on by for with from is are was were be been being it its this that ' +
     'these those as not no do does did can could will would should may might have has had about into ' +
     'than then when where which who whom what how if but so very also used mostly form etc especially').split(' ')
  );
  const GLOSS_MARK = new Set(['loanword', 'variant', 'classifier', 'coll', 'idiom', 'surname', 'bound', 'erhua', 'dialect', 'abbreviation', 'slang', 'radical', 'kangxi']);

  let reverseMap = null;
  function ensureReverseMap() {
    if (reverseMap === null) reverseMap = root.__PINYN_REVERSE || {};
    return reverseMap;
  }

  /**
   * Ricerca inversa (parola inglese -> cinese) dalla mappa completa.
   * explicit=false (implicita): solo token >=3, non-stopword.
   * explicit=true (prefisso "*"): match esatto anche parole corte/stopword.
   */
  function reverseLookup(token, explicit) {
    const t = (token || '').toLowerCase().trim();
    if (!t || !/^[a-z]+$/.test(t)) return [];
    if (!explicit && (t.length < 3 || GLOSS_STOP.has(t) || GLOSS_MARK.has(t))) return [];
    const bares = ensureReverseMap()[t];
    if (!bares || !bares.length) return [];
    const out = [];
    for (const bare of bares) {
      const d = lookupDef(bare);
      if (!d) continue;
      out.push({ bare, hanzi: d.hanzi, gloss: d.gloss });
    }
    const hasToken = (g) => g.toLowerCase().split(/[^a-z]+/).includes(t);
    out.sort((a, b) =>
      ((hasToken(b.gloss) ? 1 : 0) - (hasToken(a.gloss) ? 1 : 0)) ||
      ((levelOfWord(a.hanzi) || 9) - (levelOfWord(b.hanzi) || 9)) ||
      a.gloss.length - b.gloss.length
    );
    return out.slice(0, 4);
  }

  // ------------------------------------------------------------------
  // Popup UNICO (suggerimenti / errori / lookup)
  // ------------------------------------------------------------------
  let popEl = null;
  let popState = null;   // 'suggest' | 'errors' | 'lookup'
  let candList = [];
  let candWord = null;   // { start, end, word }
  let candOpen = false;  // popState === 'suggest' (per i tasti 1-9)

  function ensurePopEl() {
    if (popEl) return popEl;
    popEl = document.createElement('div');
    popEl.className = NS + 'pop';
    popEl.setAttribute('role', 'menu');
    popEl.hidden = true;
    popEl.addEventListener('mousedown', (e) => e.preventDefault());
    popEl.addEventListener('click', onPopClick);
    document.body.appendChild(popEl);
    return popEl;
  }

  function hidePop() {
    popState = null;
    candOpen = false;
    candList = [];
    candWord = null;
    if (popEl) { popEl.hidden = true; popEl.innerHTML = ''; }
  }

  function setPop(html, posFn) {
    const el = ensurePopEl();
    el.innerHTML = html;
    el.hidden = false;
    if (posFn) { try { posFn(el); } catch (_) { /* ignora */ } }
    try {
      const r = el.getBoundingClientRect();
      if (r.left < 4) el.style.left = '4px';
      if (r.right > window.innerWidth - 4) el.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
      if (r.top < 4) el.style.top = '4px';
      if (r.bottom > window.innerHeight - 4) el.style.top = Math.max(4, r.top - r.height - 8) + 'px';
    } catch (_) { /* ignora */ }
  }

  function onPopClick(e) {
    const item = e.target.closest('[data-i]');
    if (item && popState === 'suggest') { acceptCandidate(Number(item.dataset.i)); return; }
    const btn = e.target.closest('[data-pc-act]');
    if (!btn || !btn.dataset.pcAct || !active) return;
    const act = btn.dataset.pcAct;
    if (act === 'ignore') {
      active.ignore(btn.dataset.token);
      if (active.onRecord) active.onRecord('ignore', { token: btn.dataset.token });
    } else if (act === 'tonify') {
      if (typeof active.convertTones === 'function') {
        const n = active.convertTones();
        if (active.onRecord && n > 0) active.onRecord('tonify');
      }
    } else if (act === 'accent') {
      if (typeof active.addAccents === 'function') {
        active.addAccents(); // registra 'accent' internamente (copia anche l'auto-accento)
      }
    } else if (act === 'hanzi') {
      if (typeof active.convertToHanzi === 'function') {
        const n = active.convertToHanzi();
        if (active.onRecord && n > 0) active.onRecord('convert');
      }
    }
  }

  // ---- stato: suggerimenti (IME, tasti 1-9) ----
  function renderSuggest(list, field, formNotes) {
    formNotes = formNotes || [];
    const html = list
      .map((c, i) => {
        const hanzi = c.hanzi ? '<span class="' + NS + 'cand-hanzi">' + escapeHtml(c.hanzi) + '</span>' : '';
        const gloss = c.gloss ? '<span class="' + NS + 'cand-def">— ' + escapeHtml(c.gloss) + '</span>' : '';
        return (
          '<button class="' + NS + 'cand-item" data-i="' + i + '">' +
          '<span class="' + NS + 'cand-num">' + (i + 1) + '</span>' +
          '<span class="' + NS + 'cand-main">' + escapeHtml(c.text) + '</span>' + hanzi + gloss +
          '</button>'
        );
      })
      .join('') +
      '<div class="' + NS + 'cand-hint">1-9 accetta · Esc chiude · *parola = traduci</div>' +
      formNotes
        .map((n) => '<div class="' + NS + 'cand-note">⚠ ' + escapeHtml(n.message) + '</div>')
        .join('');
    popState = 'suggest';
    setPop(html, (el) => {
      const pos = caretScreenPos(field);
      if (!pos) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const elH = el.offsetHeight || 120;
      const elW = el.offsetWidth || 240;
      const maxH = 45 * vh / 100;
      let fieldTop = NaN;
      let fieldBottom = NaN;
      try {
        const fr = field.getBoundingClientRect();
        fieldTop = fr.top;
        fieldBottom = fr.bottom;
      } catch (_) { /* ignora */ }
      // orizzontale: inizia a destra dell'ultimo carattere scritto (al caret).
      // Se non c'è spazio a destra, allinea il bordo DESTRO del popup al caret
      // (cresce verso sinistra restando adiacente) invece di saltare a sinistra.
      let left = pos.x;
      if (left + elW > vw - 4) {
        const maxLeft = vw - elW - 4;
        const rightAlign = Math.max(4, pos.x - elW + 4);
        left = Math.max(4, Math.min(maxLeft, rightAlign));
      }
      // verticale: il popup non deve MAI coprire il campo di testo. Di norma
      // sta sotto il campo; se non c'è spazio, va sopra restando ad almeno
      // ~1,5cm (63px) dal bordo superiore del campo.
      const gap = 63; // 6px + ~1,5cm (57px)
      let top;
      if (isFinite(fieldBottom)) {
        top = fieldBottom + 6;
        const spaceBelow = vh - 4 - top;
        if (spaceBelow >= Math.min(elH, maxH)) {
          el.style.maxHeight = Math.min(maxH, spaceBelow) + 'px';
        } else {
          top = fieldTop - elH - gap;
          if (top < 4) top = 4;
          el.style.maxHeight = Math.min(maxH, Math.max(60, fieldTop - gap - top)) + 'px';
        }
      } else {
        top = pos.y + 6;
        el.style.maxHeight = Math.min(maxH, vh - 4 - top) + 'px';
      }
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    });
  }

  // ---- verifica forma della frase (regole + LM) ----
  let sentenceModel = null; // modello LM caricato (vedi llm/sentence-net.js)
  function segmentFieldWords(field) {
    const text = field.value != null ? field.value : (field.textContent || '');
    const tokens = root.PinynUtils.tokenize(text);
    const words = [];
    for (const t of tokens) {
      if (!t.isLatin) continue;
      const bare = root.PinynUtils.stripTone(t.text);
      if (!bare) continue;
      // hanzi TONO-aware (ma -> 吗, shì -> 是) con fallback a lookupDef
      const d = hanziForTone(t.text) || lookupDef(t.text);
      words.push({ bare, hanzi: d ? d.hanzi : null });
    }
    return words;
  }

  /** Punteggio LM (null finché il modello non è caricato). */
  function getSentenceScore(words) {
    if (!sentenceModel || !root.PinynSentenceNet) return null;
    try {
      return root.PinynSentenceNet.scoreSentence(sentenceModel, words.map((w) => w.bare));
    } catch (_) { return null; }
  }

  function computeFormNotes(field) {
    if (!checkForm) return [];
    const words = segmentFieldWords(field);
    if (words.length < 2) return [];
    const notes = [];
    if (root.PinynGrammar) {
      const ruleNotes = root.PinynGrammar.checkGrammar(words);
      for (const n of ruleNotes) notes.push({ index: n.index, message: n.message });
    }
    if (words.length >= 5) {
      const sc = getSentenceScore(words);
      if (sc && sc.flagged) notes.push({ index: -1, message: 'La frase ha una forma insolita (probabilità bassa).' });
    }
    return notes.slice(0, 3);
  }

  // ---- stato: errori (riepilogo + Ignora/Ok + azioni) ----
  function renderErrors(entries, accentCount, formNotes, field) {
    formNotes = formNotes || [];
    if (!pluginEnabled) { if (popState !== 'suggest') hidePop(); return; }
    const typing = Date.now() - lastTypingAt < 400;
    // il popup "correzioni" appare solo per errori REALI o note di forma,
    // non per il semplice pinyin da accentare (quello lo coprono i suggerimenti)
    if (!active || (entries.length === 0 && formNotes.length === 0)) {
      if (!typing && popState !== 'suggest') hidePop();
      return;
    }
    if (popState === 'suggest') return; // priorità ai suggerimenti
    if (typing) return; // non coprire il testo mentre si digita
    const parts = [];
    if (entries.length > 0) {
      parts.push('<div class="' + NS + 'tb-title">Pinyin — correzioni</div>');
      entries.slice(0, 5).forEach((e) => {
        const isTone = e.kind === 'tone';
        parts.push('<div class="' + NS + 'tb-row">');
        parts.push('<span class="' + NS + (isTone ? 'tb-word-susp' : 'tb-word') + '">' + escapeHtml(e.token) + (isTone ? ' <em>tono</em>' : '') + '</span>');
        parts.push(
          '<button class="' + NS + 'tb-ignore" data-pc-act="ignore" data-token="' +
          escapeHtml(e.token) + '">' + (isTone ? 'Ok' : 'Ignora') + '</button>'
        );
        parts.push('</div>');
      });
    }
    if (formNotes.length > 0) {
      parts.push('<div class="' + NS + 'tb-title">Forma</div>');
      formNotes.forEach((n) => {
        parts.push('<div class="' + NS + 'tb-row ' + NS + 'tb-form">⚠ ' + escapeHtml(n.message) + '</div>');
      });
    }
    parts.push('<div class="' + NS + 'tb-foot">');
    parts.push('<button class="' + NS + 'tb-tonify" data-pc-act="tonify">Converti toni (ni3 → nǐ)</button>');
    if (accentCount > 0) {
      parts.push('<button class="' + NS + 'tb-tonify" data-pc-act="accent">Aggiungi accenti (' + accentCount + ')</button>');
    }
    parts.push('<button class="' + NS + 'tb-tonify" data-pc-act="hanzi">Converti in caratteri</button>');
    parts.push('</div>');
    popState = 'errors';
    setPop(parts.join(''), (el) => {
      const rect = field.getBoundingClientRect();
      el.style.left = rect.left + 'px';
      el.style.maxWidth = Math.min(360, rect.width) + 'px';
      const top = rect.top - el.offsetHeight - 6;
      el.style.top = (top >= 4 ? top : rect.bottom + 6) + 'px';
    });
  }

  // ---- stato: lookup (selezione di testo nella pagina) ----
  function requestTranslate(text, tl, token) {
    const messenger = root.chrome;
    if (!messenger || !messenger.runtime || !messenger.runtime.sendMessage) return;
    try {
      messenger.runtime.sendMessage({ type: 'PC_TRANSLATE', text: text, tl: tl }, (res) => {
        if (messenger.runtime.lastError) return;
        if (translateSeq !== token) return; // selezione superata
        if (!res || !res.ok) return;        // lascia il placeholder, non bloccare
        const el = popEl && popEl.querySelector('.' + NS + 'translate');
        if (el) el.textContent = res.translation;
      });
    } catch (_) { /* ignora */ }
  }

  function lookupDictHtml(t) {
    if (/[\u3400-\u9fff]/.test(t)) {
      const hit = pinyinForHanzi(t);
      if (!hit) return null;
      const d = lookupDef(hit.pinyin_numbers);
      if (!d) return null;
      const acc = root.PinynUtils.convertToneNumbers(hit.pinyin_numbers).replace(/\s+/g, ' ');
      return d.hanzi + ' ' + acc + ' L' + levelLabel(levelOfWord(d.hanzi)) + (d.gloss ? ' · ' + d.gloss : '');
    }
    if (/^[a-zA-Züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+( [a-zA-Züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+)*$/.test(t)) {
      const d = lookupDef(t);
      if (!d) return null;
      const bare = root.PinynUtils.stripTone(t).replace(/\s+/g, '');
      const acc = currentEngine ? currentEngine.accentRun([bare])[0].text : t;
      return d.hanzi + ' ' + acc + ' L' + levelLabel(levelOfWord(d.hanzi)) + (d.gloss ? ' · ' + d.gloss : '');
    }
    return null;
  }

  /**
   * Converte una stringa di pinyin (anche con toni o compatta) in hanzi
   * best-effort, riusando la segmentazione del motore. Ritorna '' se non
   * produce alcun carattere cinese (es. testo in altre lingue).
   */
  function hanziForPinyinText(text) {
    const U = root.PinynUtils;
    const engine = currentEngine;
    if (!U || !engine) return '';
    const tokens = U.tokenize(text);
    const parts = [];
    for (let i = 0; i < tokens.length; ) {
      const t = tokens[i];
      if (!t.isLatin) { parts.push(t.text); i++; continue; }
      const group = [];
      let j = i;
      while (j < tokens.length && (tokens[j].isLatin || /^\s+$/.test(tokens[j].text))) {
        group.push(tokens[j]);
        j++;
      }
      const latins = group.filter((x) => x.isLatin);
      if (!latins.length) { i = j; continue; }
      const bares = latins.map((x) => U.stripTone(x.text));
      const segments = engine.accentRun(bares);
      let ti = 0;
      for (const seg of segments) {
        let d = null;
        if (seg.count === 1) d = hanziForTone(seg.text);
        if (!d) {
          const segBare = U.stripTone(seg.text).replace(/\s+/g, '');
          d = lookupDef(segBare);
        }
        parts.push(d && d.hanzi ? d.hanzi : seg.text);
        ti += seg.count;
      }
      i = j;
    }
    return parts.join('');
  }

  function showLookup(text) {
    if (!pluginEnabled) { hidePop(); return; }
    const t = (text || '').trim();
    if (!t) { hidePop(); return; }
    let rect = null;
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (_) { /* ignora */ }

    // lookup locale solo per testi brevi (una parola); la traduzione copre tutto
    const dictHtml = t.length <= 12 ? lookupDictHtml(t) : null;
    const canTranslate = translateEnabled && t.length <= translateMaxLen;
    if (!dictHtml && !canTranslate) { hidePop(); return; }

    // Se la selezione è pinyin, convertilo in hanzi (best-effort) così Google
    // traduce il cinese ("ni hao" -> 你好 -> "ciao") e non il pinyin grezzo.
    const isLatinOnly = /^[a-zA-Züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s]+$/.test(t);
    let sourceForTranslate = t;
    let hanziForm = '';
    if (isLatinOnly && t.length <= 80) {
      hanziForm = hanziForPinyinText(t);
      if (/[\u3400-\u9fff]/.test(hanziForm)) sourceForTranslate = hanziForm;
      else hanziForm = '';
    }

    hidePop(); // nasconde eventuali stati campo: un solo popup visibile

    const token = ++translateSeq;
    const parts = [];
    if (dictHtml) parts.push('<span class="' + NS + 'lookup-text">' + escapeHtml(dictHtml) + '</span>');
    else if (hanziForm) parts.push('<span class="' + NS + 'lookup-text">' + escapeHtml(hanziForm) + '</span>');
    if (canTranslate) parts.push('<div class="' + NS + 'translate">Traduzione…</div>');

    popState = 'lookup';
    setPop(parts.join(''), (el) => {
      if (!rect || !rect.width) return;
      el.style.left = Math.max(4, rect.left) + 'px';
      el.style.top = (rect.bottom + 6) + 'px';
    });

    if (canTranslate) requestTranslate(sourceForTranslate, translateLang, token);
  }

  let lookupInit = false;
  function initLookup() {
    if (lookupInit) return;
    lookupInit = true;
    function onMouseUp(e) {
      if (e.target.closest && e.target.closest('.' + NS + 'pop, .' + NS + 'overlay')) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      // se la selezione è dentro il campo attivo, il contesto è il campo
      if (active && active.field && sel.anchorNode && active.field.contains(sel.anchorNode)) return;
      showLookup(sel.toString());
    }
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('dblclick', onMouseUp);
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest && e.target.closest('.' + NS + 'pop')) return;
      if (popState === 'lookup') hidePop();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePop();
    });
    window.addEventListener('scroll', () => { if (popState === 'lookup') hidePop(); }, true);
  }

  // ------------------------------------------------------------------
  // Posizionamento del caret (per i suggerimenti)
  // ------------------------------------------------------------------
  function caretScreenPos(field) {
    if (field.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const rect = sel.getRangeAt(0).getClientRects()[0];
        if (rect) return { x: rect.left, y: rect.bottom };
      }
      const fr = field.getBoundingClientRect();
      return { x: fr.left, y: fr.bottom };
    }
    const cs = window.getComputedStyle(field);
    const mirror = document.createElement('div');
    const s = mirror.style;
    s.cssText = [
      'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;',
      'white-space:pre-wrap;word-wrap:break-word;box-sizing:border-box;',
      'font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize + ';font-weight:' + cs.fontWeight + ';',
      'line-height:' + cs.lineHeight + ';letter-spacing:' + cs.letterSpacing + ';',
      'padding:' + cs.padding + ';',
      'width:' + field.clientWidth + 'px;',
    ].join('');
    const sel = field.selectionStart != null ? field.selectionStart : (field.value || '').length;
    mirror.textContent = (field.value || '').slice(0, sel);
    document.body.appendChild(mirror);
    const mr = mirror.getBoundingClientRect();
    document.body.removeChild(mirror);
    const fr = field.getBoundingClientRect();
    const contentW = field.clientWidth;
    const x = fr.left + (mr.width % (contentW || mr.width));
    const lineH = parseFloat(cs.lineHeight) || Math.round(parseFloat(cs.fontSize) * 1.2);
    const y = fr.top + Math.min(mr.height || lineH, fr.height);
    return { x, y };
  }

  // ------------------------------------------------------------------
  // Parola corrente al caret
  // ------------------------------------------------------------------
  function currentWordAt(field) {
    const text = field.value != null ? field.value : (field.textContent || '');
    let caret;
    if (field.value != null) {
      caret = field.selectionStart != null ? field.selectionStart : text.length;
    } else {
      caret = caretCharOffset(field);
    }
    const isLat = (ch) => /[a-zA-Züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ0-5]/.test(ch);
    let start = caret;
    while (start > 0 && isLat(text[start - 1])) start--;
    let end = caret;
    while (end < text.length && isLat(text[end])) end++;
    if (start === end) return null;
    return { start, end, word: text.slice(start, end) };
  }

  function caretCharOffset(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return (el.textContent || '').length;
    return nodeToCharOffset(el, r.startContainer, r.startOffset);
  }

  function nodeToCharOffset(root, node, nodeOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let n = walker.nextNode();
    while (n) {
      if (n === node) return offset + nodeOffset;
      offset += n.nodeValue.length;
      n = walker.nextNode();
    }
    if (node === root) return nodeOffset;
    return -1;
  }

  // ------------------------------------------------------------------
  // Candidati (pinyin + reverse dizionario inglese)
  // ------------------------------------------------------------------
  function computeCandidates(bare, engine, opts) {
    opts = opts || {};
    const out = [];
    const seen = new Set();
    const push = (t, meta) => {
      if (!t || seen.has(t)) return;
      seen.add(t);
      const d = meta || hanziForTone(t);
      out.push({ text: t, hanzi: d ? d.hanzi : null, gloss: d ? d.gloss : null });
    };

    // modalità esplicita (prefisso "*"): SOLO traduzione inversa
    if (opts.explicitReverse) {
      // usa la parola ORIGINALE (non stripTone: evita la conversione v->ü)
      const q = opts.rawWord || bare;
      for (const r of reverseLookup(q, true)) {
        const accPinyin = currentEngine ? currentEngine.accentRun([r.bare])[0].text : r.bare;
        push(accPinyin, { hanzi: r.hanzi, gloss: r.gloss });
      }
      return out.slice(0, 6);
    }

    const variants = engine.toneVariants(bare);
    const accentForm = engine.accentRun([bare])[0].text;
    const isPinyinish = variants.length > 0 || accentForm !== bare;
    const pushPinyin = () => {
      if (variants.length) {
        variants.forEach((v) => push(v));
      } else if (accentForm && accentForm !== bare) {
        push(accentForm);
      }
      if (bare.length >= 2) {
        engine.findWordSuggestions(bare, 2)
          .map((s) => s.replace(/\s+/g, ''))
          .forEach((s) => push(s));
      }
    };

    // candidati inversi (parola inglese -> cinese); rawQ evita la v->ü
    const rawQ = opts.rawWord || bare;
    const rev = /^[a-z]+$/i.test(rawQ) ? reverseLookup(rawQ, false) : [];
    const pushReverse = () => {
      for (const r of rev) {
        const accPinyin = currentEngine ? currentEngine.accentRun([r.bare])[0].text : r.bare;
        if (!seen.has(accPinyin)) {
          seen.add(accPinyin);
          out.push({ text: accPinyin, hanzi: r.hanzi, gloss: r.gloss });
        }
      }
    };

    const strongRev = rev.length > 0;
    if (!isPinyinish && strongRev) {
      pushReverse();
      pushPinyin();
    } else {
      pushPinyin();
      pushReverse();
    }
    return out.slice(0, 8);
  }

  function updateCandidates(field, engine) {
    if (!pluginEnabled) return;
    if (!active || active.field !== field) return;
    const wi = currentWordAt(field);
    if (!wi) return; // lascia lo stato attuale (es. errori mostrati da render)
    const text = field.value != null ? field.value : (field.textContent || '');
    // dopo l'accettazione, non riproporre subito la stessa parola
    if (suppressWord) {
      if (wi.word === suppressWord) return;
      suppressWord = null; // l'utente ha cambiato parola: riattiva
    }
    const caret = field.value != null
      ? (field.selectionStart != null ? field.selectionStart : text.length)
      : caretCharOffset(field);
    // prefisso "*" = traduci esplicitamente questa parola inglese
    const explicitReverse = wi.start > 0 && text[wi.start - 1] === '*';
    // suggerimenti solo quando il caret è a fine testo (o modalità "*"): niente
    // popup che copre mentre si modifica/scorre in mezzo al testo
    if (caret < text.length && !explicitReverse) return;
    const bare = root.PinynUtils.stripTone(wi.word);
    const list = computeCandidates(bare, engine, { explicitReverse, rawWord: wi.word });
    if (list.length === 0) {
      // niente da suggerire: se erano aperti, chiudi i suggerimenti (evita
      // popup stantio che copre mentre si continua a digitare)
      if (popState === 'suggest') hidePop();
      return;
    }
    candList = list;
    // in modalità "*" l'accettazione consuma anche l'asterisco
    candWord = explicitReverse ? { start: wi.start - 1, end: wi.end, word: wi.word } : wi;
    candOpen = true;
    renderSuggest(list, field, computeFormNotes(field)); // promuove a suggerimenti
  }

  function acceptCandidate(i) {
    if (!pluginEnabled) return;
    const field = active ? active.field : null;
    if (!field || !candWord || !candList[i]) return;
    // con l'opzione attiva inserisce i caratteri (hanzi), altrimenti il pinyin
    let replacement = (insertHanzi && candList[i].hanzi) ? candList[i].hanzi : candList[i].text;
    // preserva la maiuscola iniziale del token originale (Wo -> Wǒ)
    if (/^[A-Z]/.test(candWord.word) && /^[a-zü]/.test(replacement)) {
      replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    // non riproporre la parola appena accettata
    suppressWord = replacement;
    // opzione: spazio dopo il suggerimento
    if (spaceAfterAccept) replacement += ' ';
    const { start, end } = candWord;
    const token = candWord.word;
    const text = field.value != null ? field.value : (field.textContent || '');
    const newText = text.slice(0, start) + replacement + text.slice(end);
    if (field.value != null) {
      field.value = newText;
      try { field.setSelectionRange(start + replacement.length, start + replacement.length); } catch (_) { /* ignore */ }
      field.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      replaceInContentEditable(field, start, end, replacement);
      try {
        const a = textNodeAtOffset(field, start + replacement.length);
        if (a) {
          const range = document.createRange();
          range.setStart(a.node, a.offset);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (_) { /* ignore */ }
    }
    hidePop();
    if (active && active.onRecord && token) {
      active.onRecord('correction', { token, suggestion: replacement });
    }
  }

  function onKeyDown(e) {
    if (!pluginEnabled || !candOpen) return;
    if (/^[1-9]$/.test(e.key)) {
      // Seleziona il suggerimento numerato (1-9), come mostrato nel popup.
      // I numeri dei toni (ni3 -> nǐ) si digitano normalmente: durante la
      // digitazione veloce il popup non è ancora aperto (debounce 200ms),
      // quindi le cifre non vengono intercettate.
      const idx = Number(e.key) - 1;
      if (idx < candList.length) {
        e.preventDefault();
        acceptCandidate(idx);
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (candList.length) {
        e.preventDefault();
        acceptCandidate(0);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hidePop();
    }
  }

  // ------------------------------------------------------------------
  // Auto-accentuazione (debounce)
  // ------------------------------------------------------------------
  function makeAutoAccent(enabled, action) {
    let active_ = !!enabled;
    let timer = null;
    function schedule() {
      clearTimeout(timer);
      if (!active_) return;
      timer = setTimeout(() => {
        if (!pluginEnabled) return; // rispetta il toggle globale
        if (document.activeElement !== action.field) return;
        const n = action.apply();
        if (n > 0) action.render();
      }, 800);
    }
    return {
      set(en) {
        active_ = !!en;
        if (active_) schedule(); else clearTimeout(timer);
      },
      clear() { clearTimeout(timer); },
      schedule,
      get enabled() { return active_; },
    };
  }

  // ------------------------------------------------------------------
  // Salvataggio/ripristino del caret (per le sostituzioni in-place)
  // ------------------------------------------------------------------
  function saveCaret(field) {
    if (field.value != null) {
      return {
        kind: 'value',
        start: field.selectionStart != null ? field.selectionStart : (field.value || '').length,
        end: field.selectionEnd != null ? field.selectionEnd : field.selectionStart,
      };
    }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!field.contains(range.startContainer)) return null;
    const start = nodeToCharOffset(field, range.startContainer, range.startOffset);
    const end = range.collapsed ? start : nodeToCharOffset(field, range.endContainer, range.endOffset);
    return { kind: 'ce', start, end };
  }

  function restoreCaret(field, caret) {
    if (!caret) return;
    if (caret.kind === 'value') {
      try {
        const v = field.value || '';
        const s = Math.max(0, Math.min(caret.start, v.length));
        const e = Math.max(s, Math.min(caret.end, v.length));
        field.setSelectionRange(s, e);
      } catch (_) { /* ignore */ }
      return;
    }
    if (caret.start < 0) return;
    try {
      const a = textNodeAtOffset(field, caret.start);
      if (!a) return;
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      if (caret.end >= 0 && caret.end !== caret.start) {
        const b = textNodeAtOffset(field, caret.end);
        if (b) range.setEnd(b.node, b.offset);
        else range.collapse(true);
      } else {
        range.collapse(true);
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // Handle per textarea/input
  // ------------------------------------------------------------------
  function installOverlay(field, detector, engine, options) {
    field.style.position = 'relative';
    const mirror = createMirrorOverlay(field);

    function getEntries() { return detector.scan(field.value); }
    function getAccentCount() { return detector.accentable(field.value).length; }

    function render(entries) {
      entries = entries || getEntries();
      mirror.render(entries);
      renderErrors(entries, getAccentCount(), computeFormNotes(field), field);
      return entries;
    }

    function replaceRange(start, end, replacement) {
      const v = field.value;
      field.value = v.slice(0, start) + replacement + v.slice(end);
      try { field.setSelectionRange(start, start + replacement.length); } catch (_) { /* ignore */ }
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function convertTones() {
      const caret = saveCaret(field);
      const before = field.value;
      const n = convertTonesIn(field, (s, e, r) => {
        const v = field.value;
        field.value = v.slice(0, s) + r + v.slice(e);
      });
      if (n > 0 && field.value !== before) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      restoreCaret(field, caret);
      return n;
    }

    function addAccents() {
      const caret = saveCaret(field);
      const before = field.value;
      const n = applyAccentsIn(field, engine, (s, e, r) => {
        const v = field.value;
        field.value = v.slice(0, s) + r + v.slice(e);
      });
      if (n > 0 && field.value !== before) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      restoreCaret(field, caret);
      if (n > 0 && active && active.onRecord) active.onRecord('accent');
      return n;
    }

    function convertToHanzi() {
      const before = field.value;
      const n = applyHanziIn(field, engine, (s, e, r) => {
        const v = field.value;
        field.value = v.slice(0, s) + r + v.slice(e);
      });
      if (n > 0 && field.value !== before) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return n;
    }

    const autoAccent = makeAutoAccent(options && options.autoAccent, {
      field,
      apply: addAccents,
      render,
    });

    const inputListener = () => {
      lastTypingAt = Date.now();
      hidePop(); // non coprire il testo mentre si digita; i suggerimenti riappaiono dopo la pausa
      if (!field.value) { render([]); return; }
      render();
      autoAccent.schedule();
    };
    field.addEventListener('input', inputListener);
    render();

    return {
      type: 'field',
      field,
      render,
      getEntries,
      replaceRange,
      convertTones,
      addAccents,
      convertToHanzi,
      setInsertHanzi: (v) => { insertHanzi = !!v; },
      setCheckForm: (v) => { checkForm = v !== false; },
      setSpaceAfterAccept: (v) => { spaceAfterAccept = !!v; },
      setTranslateEnabled: (v, lang, maxLen) => { setTranslate(v, lang, maxLen); },
      setSentenceModel: (m) => {
        sentenceModel = m;
        if (active && active.field === field) render();
      },
      setLazyData: () => {
        reverseMap = null;
        hanziToPinyin = null;
        if (active) render();
      },
      setAutoAccent: autoAccent.set,
      ignore: (token) => { detector.ignore(token); render(); },
      destroy() {
        autoAccent.clear();
        mirror.destroy();
        field.removeEventListener('input', inputListener);
        if (active && active.field === field) deactivate();
      },
    };
  }

  // ------------------------------------------------------------------
  // Handle per contenteditable
  // ------------------------------------------------------------------
  function installContentEditable(el, detector, engine, options) {
    el.style.position = 'relative';
    const mirror = createMirrorOverlay(el);

    function getText() { return el.innerText != null ? el.innerText : (el.textContent || ''); }

    function render() {
      const entries = detector.scan(getText());
      const accentCount = detector.accentable(getText()).length;
      mirror.render(entries);
      renderErrors(entries, accentCount, computeFormNotes(el), el);
      return entries;
    }

    function replaceRange(start, end, replacement) {
      replaceInContentEditable(el, start, end, replacement);
    }

    function convertTones() {
      const caret = saveCaret(el);
      const n = convertTonesIn(el, (s, e, r) => replaceInContentEditable(el, s, e, r));
      if (n > 0) el.dispatchEvent(new Event('input', { bubbles: true }));
      restoreCaret(el, caret);
      return n;
    }

    function addAccents() {
      const caret = saveCaret(el);
      const n = applyAccentsIn(el, engine, (s, e, r) => replaceInContentEditable(el, s, e, r));
      if (n > 0) el.dispatchEvent(new Event('input', { bubbles: true }));
      restoreCaret(el, caret);
      if (n > 0 && active && active.onRecord) active.onRecord('accent');
      return n;
    }

    function convertToHanzi() {
      const n = applyHanziIn(el, engine, (s, e, r) => replaceInContentEditable(el, s, e, r));
      if (n > 0) el.dispatchEvent(new Event('input', { bubbles: true }));
      return n;
    }

    const autoAccent = makeAutoAccent(options && options.autoAccent, {
      field: el,
      apply: addAccents,
      render,
    });

    const inputListener = () => {
      lastTypingAt = Date.now();
      hidePop(); // non coprire il testo mentre si digita
      render();
      autoAccent.schedule();
    };
    el.addEventListener('input', inputListener);
    render();

    return {
      type: 'ce',
      field: el,
      render,
      getEntries: () => detector.scan(getText()),
      replaceRange,
      convertTones,
      addAccents,
      convertToHanzi,
      setInsertHanzi: (v) => { insertHanzi = !!v; },
      setCheckForm: (v) => { checkForm = v !== false; },
      setSpaceAfterAccept: (v) => { spaceAfterAccept = !!v; },
      setTranslateEnabled: (v, lang, maxLen) => { setTranslate(v, lang, maxLen); },
      setSentenceModel: (m) => {
        sentenceModel = m;
        if (active && active.field === field) render();
      },
      setLazyData: () => {
        reverseMap = null;
        hanziToPinyin = null;
        if (active) render();
      },
      setAutoAccent: autoAccent.set,
      ignore: (token) => { detector.ignore(token); render(); },
      destroy() {
        autoAccent.clear();
        mirror.destroy();
        el.removeEventListener('input', inputListener);
        if (active && active.field === el) deactivate();
      },
    };
  }

  // ------------------------------------------------------------------
  // Gestione campo attivo
  // ------------------------------------------------------------------
  function setActive(handle) {
    if (active && active.field !== handle.field) deactivate();
    active = handle;
  }
  function deactivate() {
    active = null;
    suppressWord = null;
    hidePop();
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.classList && el.classList.contains(NS + 'overlay')) return false;
    if (el.closest && el.closest('.' + NS + 'overlay, .' + NS + 'pop')) return false;
    if (el.isContentEditable) {
      const host = el.closest('[contenteditable]');
      return host === el;
    }
    if (/(TEXTAREA|INPUT)/.test(el.tagName)) {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const editable = ['text', 'search', 'url', 'tel', 'email', 'password'].includes(type);
      return editable && !el.readOnly && !el.disabled;
    }
    return false;
  }

  function attach(element, detector, engine, options) {
    options = options || {};
    const handle = element.isContentEditable
      ? installContentEditable(element, detector, engine, options)
      : installOverlay(element, detector, engine, options);

    handle.onRecord = options.onRecord || null;
    currentEngine = engine;
    insertHanzi = !!options.insertHanzi;
    checkForm = options.checkForm !== false;
    spaceAfterAccept = !!options.spaceAfterAccept;
    setTranslate(options.translateEnabled !== false, options.translateLang, options.translateMaxLen);
    initLookup();

    element.addEventListener('focus', () => {
      setActive(handle);
      handle.render();
      updateCandidates(element, engine);
    });
    element.addEventListener('blur', () => {
      clearTimeout(suggestTimer);
      suppressWord = null;
      hidePop();
      if (active && active.field === element) deactivate();
    });
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('input', () => {
      // debounce: i suggerimenti compaiono dopo una breve pausa, così non
      // coprono il testo mentre si digita velocemente
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => {
        suggestTimer = null;
        updateCandidates(element, engine);
      }, 200);
    });

    return handle;
  }

  root.PinynUi = { attach, isEditable, setEnabled };
})(typeof globalThis !== 'undefined' ? globalThis : this);
