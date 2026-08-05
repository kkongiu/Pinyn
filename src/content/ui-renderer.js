/**
 * UiRenderer — evidenziazione degli errori pinyin + toolbar di correzione.
 * NON tocca mai il DOM dei campi editabili: usa un overlay speculare
 * (stesso font/padding, testo trasparente, sottolineatura rossa) sopra il
 * campo, con pointer-events:none. In questo modo la digitazione resta
 * naturale (nessun problema di caret/direzione).
 * Espone globalmente `PinynUi`.
 */
(function (root) {
  'use strict';

  const NS = 'pc-';

  function escapeHtml(s) {
    return s
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
      const text = getText();
      let i = 0;
      const parts = [];
      for (const e of entries) {
        if (e.start > i) parts.push(escapeHtml(text.slice(i, e.start)));
        const seg = escapeHtml(text.slice(e.start, e.end));
        const title = e.suggestions.length
          ? 'Pinyin: ' + e.suggestions.join(', ')
          : 'Pinyin sconosciuto';
        parts.push(
          '<mark class="' + NS + 'err" title="' + title + '">' + seg + '</mark>'
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
   * o tono più frequente). Le sostituzioni sono lunghezza-preservanti.
   */
  function applyAccentsIn(field, engine, applyReplace) {
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
      const run = [];
      let j = i;
      while (j < tokens.length && tokens[j].isLatin) { run.push(tokens[j]); j++; }
      const bares = run.map((t) => root.PinynUtils.stripTone(t.text));
      const toned = engine.addAccentsToPhrase(bares);
      let runOffset = offset;
      for (let k = 0; k < run.length; k++) {
        const t = run[k];
        const start = runOffset;
        const end = runOffset + t.text.length;
        runOffset = end;
        if (root.PinynUtils.isToneNumbered(t.text)) continue;
        if (root.PinynUtils.hasToneMark(t.text)) continue;
        if (toned[k] && toned[k] !== t.text) edits.push({ start, end, repl: toned[k] });
      }
      offset = runOffset;
      i = j;
    }
    for (let k = edits.length - 1; k >= 0; k--) {
      applyReplace(edits[k].start, edits[k].end, edits[k].repl);
    }
    return edits.length;
  }

  // ------------------------------------------------------------------
  // Toolbar
  // ------------------------------------------------------------------
  let toolbarEl = null;
  let active = null;

  function ensureToolbar() {
    if (toolbarEl) return toolbarEl;
    toolbarEl = document.createElement('div');
    toolbarEl.className = NS + 'toolbar';
    toolbarEl.setAttribute('role', 'menu');
    toolbarEl.hidden = true;
    toolbarEl.addEventListener('mousedown', (e) => e.preventDefault());
    toolbarEl.addEventListener('click', onToolbarClick);
    document.body.appendChild(toolbarEl);
    return toolbarEl;
  }

  function onToolbarClick(e) {
    const btn = e.target.closest('[data-pc-act]');
    if (!btn || !btn.dataset.pcAct) return;
    const act = btn.dataset.pcAct;
    if (!active) return;

    if (act === 'replace') {
      active.replaceRange(Number(btn.dataset.s), Number(btn.dataset.e), btn.dataset.sug);
    } else if (act === 'ignore') {
      active.ignore(btn.dataset.token);
    } else if (act === 'tonify') {
      if (typeof active.convertTones === 'function') active.convertTones();
    } else if (act === 'accent') {
      if (typeof active.addAccents === 'function') active.addAccents();
    }
  }

  function renderToolbar(entries, accentCount) {
    const t = ensureToolbar();
    if (!active || (entries.length === 0 && !accentCount)) {
      t.hidden = true;
      return;
    }
    const parts = [];
    if (entries.length > 0) {
      parts.push('<div class="' + NS + 'tb-title">Pinyin — correzioni</div>');
      entries.slice(0, 6).forEach((e) => {
        parts.push('<div class="' + NS + 'tb-row">');
        parts.push('<span class="' + NS + 'tb-word">' + escapeHtml(e.token) + '</span>');
        if (e.suggestions.length) {
          e.suggestions.slice(0, 4).forEach((s) => {
            parts.push(
              '<button class="' + NS + 'tb-sug" data-pc-act="replace" data-s="' + e.start +
              '" data-e="' + e.end + '" data-sug="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>'
            );
          });
        }
        parts.push(
          '<button class="' + NS + 'tb-ignore" data-pc-act="ignore" data-token="' +
          escapeHtml(e.token) + '">Ignora</button>'
        );
        parts.push('</div>');
      });
    } else if (accentCount > 0) {
      parts.push('<div class="' + NS + 'tb-title">Pinyin</div>');
      parts.push('<div class="' + NS + 'tb-row">Nessun errore. Parole da accentuare: ' + accentCount + '</div>');
    }
    parts.push('<div class="' + NS + 'tb-foot">');
    parts.push('<button class="' + NS + 'tb-tonify" data-pc-act="tonify">Converti toni (ni3 → nǐ)</button>');
    if (accentCount > 0) {
      parts.push('<button class="' + NS + 'tb-tonify" data-pc-act="accent">Aggiungi accenti (' + accentCount + ')</button>');
    }
    parts.push('<span>Clicca una parola per sostituirla.</span>');
    parts.push('</div>');
    t.innerHTML = parts.join('');
    t.hidden = false;
    positionToolbar();
  }

  function positionToolbar() {
    if (!active || !toolbarEl) return;
    const rect = active.field.getBoundingClientRect();
    toolbarEl.style.left = rect.left + 'px';
    const top = rect.top - toolbarEl.offsetHeight - 6;
    toolbarEl.style.top = (top >= 4 ? top : rect.bottom + 6) + 'px';
    toolbarEl.style.maxWidth = Math.min(360, rect.width) + 'px';
  }

  // ------------------------------------------------------------------
  // Popup candidati (suggeritore IME-like)
  // ------------------------------------------------------------------
  let candEl = null;
  let candList = [];
  let candWord = null; // { start, end, word }
  let candOpen = false;

  function ensureCandEl() {
    if (candEl) return candEl;
    candEl = document.createElement('div');
    candEl.className = NS + 'cand';
    candEl.hidden = true;
    candEl.addEventListener('mousedown', (e) => e.preventDefault());
    candEl.addEventListener('click', (e) => {
      const b = e.target.closest('[' + 'data-i' + ']');
      if (b) acceptCandidate(Number(b.dataset.i));
    });
    document.body.appendChild(candEl);
    return candEl;
  }

  function hideCandidates() {
    candOpen = false;
    candList = [];
    candWord = null;
    if (candEl) candEl.hidden = true;
  }

  function currentWordAt(field) {
    const text = field.value != null ? field.value : (field.textContent || '');
    let caret;
    if (field.value != null) {
      caret = field.selectionStart != null ? field.selectionStart : text.length;
    } else {
      caret = caretCharOffset(field);
    }
    const isLat = (ch) => /[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(ch);
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

  function computeCandidates(bare, engine) {
    const out = [];
    const seen = new Set();
    const push = (t) => {
      if (!t || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };
    if (bare.length >= 1) {
      const acc = engine.accentSingle(bare);
      if (acc && acc !== bare) push(acc);
    }
    if (bare.length >= 2) {
      engine.findWordSuggestions(bare, 2).forEach(push);
    }
    return out.slice(0, 6);
  }

  function updateCandidates(field, engine) {
    if (!active || active.field !== field) { hideCandidates(); return; }
    const wi = currentWordAt(field);
    if (!wi) { hideCandidates(); return; }
    const bare = root.PinynUtils.stripTone(wi.word);
    const list = computeCandidates(bare, engine);
    if (list.length === 0) { hideCandidates(); return; }
    candList = list;
    candWord = wi;
    candOpen = true;
    const el = ensureCandEl();
    el.innerHTML =
      list
        .map((c, i) =>
          '<button class="' + NS + 'cand-item" data-i="' + i + '"><span class="' + NS + 'cand-num">' + (i + 1) + '</span>' + escapeHtml(c) + '</button>'
        )
        .join('') +
      '<div class="' + NS + 'cand-hint">1-9 accetta · Esc chiude</div>';
    el.hidden = false;
    positionCand(field);
  }

  function positionCand(field) {
    if (!candEl || !active) return;
    const pos = caretScreenPos(field);
    if (!pos) return;
    candEl.style.left = pos.x + 'px';
    candEl.style.top = (pos.y + 6) + 'px';
    // tieni dentro la viewport
    const r = candEl.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) candEl.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
    if (r.bottom > window.innerHeight - 4) candEl.style.top = Math.max(4, pos.y - r.height - 8) + 'px';
  }

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
    // input/textarea: mirror
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

  function acceptCandidate(i) {
    const field = active ? active.field : null;
    if (!field || !candWord || !candList[i]) return;
    const replacement = candList[i];
    const { start, end } = candWord;
    const text = field.value != null ? field.value : (field.textContent || '');
    const newText = text.slice(0, start) + replacement + text.slice(end);
    if (field.value != null) {
      field.value = newText;
      // caret collassato DOPO la parola accettata (niente selezione)
      try { field.setSelectionRange(start + replacement.length, start + replacement.length); } catch (_) { /* ignore */ }
      field.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      replaceInContentEditable(field, start, end, replacement);
      // caret alla fine della sostituzione
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
    hideCandidates();
  }

  function onKeyDown(e) {
    if (!candOpen) return;
    if (/^[1-9]$/.test(e.key)) {
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
      hideCandidates();
    }
  }

  /**
   * Gestisce l'auto-accentuazione con debounce. Ritorna { set(enabled), clear() }.
   */
  function makeAutoAccent(enabled, action) {
    let active_ = !!enabled;
    let timer = null;
    function schedule() {
      clearTimeout(timer);
      if (!active_) return;
      timer = setTimeout(() => {
        // accentua solo se l'utente è ancora in quel campo
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
    // contenteditable: offset di carattere nel textContent
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
    // contenteditable
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

  function nodeToCharOffset(root, node, nodeOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let n = walker.nextNode();
    while (n) {
      if (n === node) return offset + nodeOffset;
      offset += n.nodeValue.length;
      n = walker.nextNode();
    }
    // il nodo non è un text node (es. l'elemento stesso): stima
    if (node === root) return nodeOffset;
    return -1;
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
      renderToolbar(entries, getAccentCount());
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
      return n;
    }

    const autoAccent = makeAutoAccent(options && options.autoAccent, {
      field,
      apply: addAccents,
      render,
    });

    const inputListener = () => {
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
  // Handle per contenteditable (nessuna modifica del DOM editabile)
  // ------------------------------------------------------------------
  function installContentEditable(el, detector, engine, options) {
    el.style.position = 'relative';
    const mirror = createMirrorOverlay(el);

    function getText() { return el.innerText != null ? el.innerText : (el.textContent || ''); }

    function render() {
      const entries = detector.scan(getText());
      const accentCount = detector.accentable(getText()).length;
      mirror.render(entries);
      renderToolbar(entries, accentCount);
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
      return n;
    }

    const autoAccent = makeAutoAccent(options && options.autoAccent, {
      field: el,
      apply: addAccents,
      render,
    });

    const inputListener = () => {
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
    if (toolbarEl) toolbarEl.hidden = true;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    // Ignora la nostra UI
    if (el.classList && el.classList.contains(NS + 'overlay')) return false;
    if (el.closest && el.closest('.' + NS + 'overlay, .' + NS + 'toolbar')) return false;
    if (el.isContentEditable) {
      // Solo l'editing host vero, non i suoi discendenti (in Chrome
      // riportano isContentEditable === true ma non sono campi).
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
    const handle = element.isContentEditable
      ? installContentEditable(element, detector, engine, options)
      : installOverlay(element, detector, engine, options);

    element.addEventListener('focus', () => {
      setActive(handle);
      handle.render();
      positionToolbar();
      updateCandidates(element, engine);
    });
    element.addEventListener('blur', () => {
      hideCandidates();
      if (active && active.field === element) deactivate();
    });
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('input', () => updateCandidates(element, engine));

    return handle;
  }

  root.PinynUi = { attach, isEditable };
})(typeof globalThis !== 'undefined' ? globalThis : this);
