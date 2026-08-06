/**
 * Content Script — orchestrazione: carica il dizionario, osserva i campi
 * editabili e applica l'evidenziazione degli errori pinyin.
 */
(function () {
  'use strict';

  const active = new WeakMap();
  // Set parallelo: WeakMap non è iterabile (non ha forEach/keys).
  const allHandles = new Set();

  // Sillabe iniettate direttamente (data/pinyin-syllables.js) — nessun fetch,
  // quindi funziona anche senza web_accessible_resources.
  const syllableSet = new Set(window.__PINYN_SYLLABLES || []);
  // Copia BASE del vocabolario compatto: non viene mai mutata, così i termini
  // utente si applicano in modo idempotente senza accumuli.
  const baseHsk = (window.__PINYN_HSK || []).slice();
  const hskWords = baseHsk;

  // Engine condiviso (i detector lo referenziano: i cambi di livello si
  // propagano a tutti senza riattaccare i campi).
  const engine = PinynCorrectionEngine.createEngine({
    syllables: syllableSet,
    hskWords,
    hskLevel: 3,
  });

  // ---------- termini personalizzati (dizionario utente) ----------
  const CT = window.PinynCustomTerms;
  let customTerms = [];
  const customRestore = {};
  function applyCustomTerms(terms) {
    customTerms = terms || [];
    if (CT) CT.pruneGlobals(baseHsk, customTerms, customRestore);
    engine.setWords(baseHsk.concat(customTerms.map(CT ? CT.toHskEntry : (t) => ({ w: t.hanzi, p: t.pinyin, l: 0 }))));
    propagateOptions();
  }
  function loadCustomTerms() {
    chrome.storage.local.get('customTerms', (data) => {
      if (Array.isArray(data.customTerms)) {
        applyCustomTerms(data.customTerms);
      } else {
        // migra da storage.sync (nuovo dispositivo / versione precedente)
        chrome.storage.sync.get('customTerms', (syncData) => {
          if (Array.isArray(syncData.customTerms) && syncData.customTerms.length) {
            chrome.storage.local.set({ customTerms: syncData.customTerms });
            applyCustomTerms(syncData.customTerms);
          }
        });
      }
    });
  }
  loadCustomTerms();

  let autoAccentEnabled = false;
  let insertHanzi = false;
  let checkForm = true;
  let spaceAfterAccept = false;
  let translateEnabled = true;
  let translateLang = defaultTranslateLang();
  let translateMaxLen = 500;

  function defaultTranslateLang() {
    try {
      const ui = (chrome.i18n.getUILanguage() || '').split('-')[0].toLowerCase();
      return /^[a-z]{2}$/.test(ui) ? ui : 'it';
    } catch (_) {
      return 'it';
    }
  }

  chrome.storage.sync.get({ hskLevel: 3, autoAccent: false, hanzi: false, grammar: true, spaceAfterAccept: false, translate: true, translateLang: '', translateMaxLen: 500 }, (data) => {
    engine.setLevel(Number(data.hskLevel) || 3);
    autoAccentEnabled = !!data.autoAccent;
    insertHanzi = !!data.hanzi;
    checkForm = data.grammar !== false;
    spaceAfterAccept = !!data.spaceAfterAccept;
    translateEnabled = data.translate !== false;
    translateLang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(data.translateLang || '')) ? data.translateLang : defaultTranslateLang();
    const n = Number(data.translateMaxLen);
    translateMaxLen = n >= 1 && n <= 2000 ? n : 500;
    propagateOptions();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enabled) {
      applyEnabled(changes.enabled.newValue !== false);
    }
    if (changes.hskLevel) {
      engine.setLevel(Number(changes.hskLevel.newValue) || 3);
    }
    if (changes.autoAccent) {
      autoAccentEnabled = !!changes.autoAccent.newValue;
      propagateOptions();
    }
    if (changes.toneNet) {
      if (changes.toneNet.newValue) loadTonePredictor();
      else engine.setTonePredictor(null);
    }
    if (changes.hanzi) {
      insertHanzi = !!changes.hanzi.newValue;
      propagateOptions();
    }
    if (changes.grammar) {
      checkForm = changes.grammar.newValue !== false;
      if (checkForm && !sentenceModel) loadSentenceModel();
      propagateOptions();
    }
    if (changes.spaceAfterAccept) {
      spaceAfterAccept = !!changes.spaceAfterAccept.newValue;
      propagateOptions();
    }
    if (changes.translate) {
      translateEnabled = changes.translate.newValue !== false;
      propagateOptions();
    }
    if (changes.translateLang) {
      const v = String(changes.translateLang.newValue || '');
      translateLang = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(v) ? v : defaultTranslateLang();
      propagateOptions();
    }
    if (changes.translateMaxLen) {
      const n = Number(changes.translateMaxLen.newValue);
      translateMaxLen = n >= 1 && n <= 2000 ? n : 500;
      propagateOptions();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.customTerms) {
      applyCustomTerms(changes.customTerms.newValue || []);
    }
  });

  // Rete neurale dei toni (caricamento lazy, con fallback all'euristica).
  function loadTonePredictor() {
    if (!window.PinynToneNet) return;
    window.PinynToneNet.loadToneNet().then((model) => {
      if (model) {
        engine.setTonePredictor((bares) => window.PinynToneNet.predictTones(model, bares));
      }
    });
  }
  chrome.storage.sync.get({ toneNet: true }, (data) => {
    if (data.toneNet !== false) loadTonePredictor();
  });

  // LM di forma (caricamento lazy, ~1.4MB). Se il caricamento fallisce
  // resta null: il blocco "Forma" mostra solo le regole grammaticali.
  let sentenceModel = null;
  function loadSentenceModel() {
    if (!window.PinynSentenceNet) return;
    window.PinynSentenceNet.loadSentenceNet().then((m) => {
      sentenceModel = m;
      propagateOptions();
    });
  }
  if (checkForm) loadSentenceModel();

  // Dati lazy (non iniettati in ogni pagina): reverse dizionario (*parola)
  // e POS (regole grammaticali). Vengono fetchati come testo .js e parsimoniosi
  // dopo il caricamento della pagina; quando arrivano, gli handle si ri-renderizzano.
  let lazyDataDone = false;
  function fetchLazyData(file) {
    const url = chrome.runtime.getURL('data/' + file);
    return fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then((txt) => {
        const eq = txt.indexOf('=');
        if (eq < 0) throw new Error('formato');
        return JSON.parse(txt.slice(eq + 1).replace(/;\s*$/, ''));
      });
  }
  function loadLazyData() {
    if (lazyDataDone) return;
    lazyDataDone = true;
    const jobs = [];
    if (window.__PINYN_REVERSE == null) {
      jobs.push(fetchLazyData('hsk-reverse.js').then((d) => { window.__PINYN_REVERSE = d; }).catch(() => {}));
    }
    if (window.__PINYN_POS == null) {
      jobs.push(fetchLazyData('hsk-pos.js').then((d) => { window.__PINYN_POS = d; }).catch(() => {}));
    }
    if (jobs.length) Promise.all(jobs).then(() => {
      propagateOptions();
      // il reverse appena caricato ha sostituito il global: ri-applica i termini
      if (customTerms.length) applyCustomTerms(customTerms);
    });
  }
  setTimeout(loadLazyData, 800);

  function propagateOptions() {
    allHandles.forEach((handle) => {
      if (handle && typeof handle.setAutoAccent === 'function') {
        handle.setAutoAccent(autoAccentEnabled);
      }
      if (handle && typeof handle.setInsertHanzi === 'function') {
        handle.setInsertHanzi(insertHanzi);
      }
      if (handle && typeof handle.setCheckForm === 'function') {
        handle.setCheckForm(checkForm);
      }
      if (handle && typeof handle.setSpaceAfterAccept === 'function') {
        handle.setSpaceAfterAccept(spaceAfterAccept);
      }
      if (handle && typeof handle.setTranslateEnabled === 'function') {
        handle.setTranslateEnabled(translateEnabled, translateLang, translateMaxLen);
      }
      if (handle && typeof handle.setSentenceModel === 'function') {
        handle.setSentenceModel(checkForm ? sentenceModel : null);
      }
      if (handle && typeof handle.setLazyData === 'function' && lazyDataDone) {
        handle.setLazyData();
      }
    });
  }

  // Popola IndexedDB (non bloccante)
  if (PinynHskDb && window.__PINYN_HSK) {
    const full = window.__PINYN_HSK.map((w) => ({
      id: w.w, word: w.w, pinyin_numbers: w.p, level: w.l, pinyin: '', definitions: [],
    }));
    window.__PINYN_HSK_SEED = PinynHskDb.seed(full).catch(() => false);
  }

  // Statistiche: scrive gli eventi su IndexedDB (non bloccante, con coda).
  const statQueue = [];
  let statFlushing = false;
  function recordStat(type, detail) {
    if (!PinynHskDb) return;
    statQueue.push({ type, detail: detail || {} });
    flushStats();
  }
  async function flushStats() {
    if (statFlushing) return;
    statFlushing = true;
    while (statQueue.length) {
      const { type, detail } = statQueue.shift();
      try {
        await PinynHskDb.recordStat({
          type,
          token: detail.token || null,
          suggestion: detail.suggestion || null,
          level: detail.suggestion ? engine.pinyinLevel(detail.suggestion) : null,
        });
      } catch (_) { /* ignora errori di scrittura */ }
    }
    statFlushing = false;
  }

  function attachToField(field) {
    if (!PinynUi.isEditable(field)) return;
    if (active.has(field)) return;
    const detector = PinynErrorDetector.createDetector(syllableSet, { engine });
    const handle = PinynUi.attach(field, detector, engine, {
      autoAccent: autoAccentEnabled,
      insertHanzi,
      checkForm,
      spaceAfterAccept,
      translateEnabled,
      translateLang,
      translateMaxLen,
      onRecord: recordStat,
    });
    active.set(field, handle);
    allHandles.add(handle);
  }

  function detach(field) {
    const handle = active.get(field);
    if (handle) {
      handle.destroy();
      active.delete(field);
      allHandles.delete(handle);
    }
  }

  function scanFields(root) {
    root = root || document;
    const fields = root.querySelectorAll('textarea, input[type="text"], input[type="search"], [contenteditable="true"]');
    fields.forEach(attachToField);
  }

  // Osserva futuri elementi — attivo dopo un frame per evitare reentranza
  // durante l'attach iniziale.
  let attaching = false;
  const mo = new MutationObserver((muts) => {
    if (attaching) return; // semaforo anti-cascata
    attaching = true;
    try {
      for (const m of muts) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          // ignora la nostra UI (overlay/toolbar) e i suoi contenuti
          if (node.classList && node.classList.contains('pc-overlay')) return;
          if (node.classList && node.classList.contains("pc-pop")) return;
          attachToField(node);
          scanFields(node);
        });
      }
    } finally {
      attaching = false;
    }
  });

  scanFields(document);
  requestAnimationFrame(() => {
    mo.observe(document.body, { childList: true, subtree: true });
  });

  function applyEnabled(enabled) {
    document.body.classList.toggle('pc-disabled', !enabled);
    if (PinynUi.setEnabled) PinynUi.setEnabled(enabled);
  }
  chrome.storage.sync.get({ enabled: true }, (data) => {
    applyEnabled(data.enabled !== false);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (msg && msg.type === 'PC_SET_ENABLED') {
      applyEnabled(!!msg.enabled);
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'PC_GET_SELECTION') {
      const sel = window.getSelection();
      const text = (sel && sel.toString() || '').trim();
      sendResponse({ selection: text.slice(0, 200) });
    } else if (msg && msg.type === 'PC_SEARCH_DICT') {
      sendResponse({ results: dictSearch(msg.q, msg.limit || 20) });
    }
  });

  // Ricerca dizionario per il popup: riusa i dati già iniettati
  // (__PINYN_HSK + __PINYN_DEFS + __PINYN_REVERSE + __PINYN_POS),
  // niente fetch di hsk-3.0.json (2.7MB) dal popup.
  function dictSearch(query, limit) {
    const HSK = window.__PINYN_HSK || [];
    const DEFS = window.__PINYN_DEFS || {};
    const REV = window.__PINYN_REVERSE || {};
    const POS = window.__PINYN_POS || {};
    const U = window.PinynUtils;
    const q = (query || '').trim().toLowerCase();
    if (!q || !U) return [];
    const hasHanzi = /[\u3400-\u9fff]/.test(q);
    const qBare = U.stripTone(q).replace(/[0-5]/g, '').replace(/\s+/g, '');
    const bare = (pn) => U.stripTone(pn).replace(/[0-5]/g, '').replace(/\s+/g, '');
    const results = [];
    const seen = new Set();
    const push = (word, pn, lvl, gloss) => {
      if (!word || seen.has(word)) return;
      seen.add(word);
      results.push({
        word,
        pinyin: U.convertToneNumbers(pn || word),
        level: lvl || 0,
        pos: POS[word] || '',
        definitions: gloss ? [gloss] : [],
      });
    };
    const glossFor = (pn) => {
      const v = DEFS[pn];
      if (!v) return '';
      const i = v.indexOf('|');
      return i >= 0 ? v.slice(i + 1) : '';
    };
    if (hasHanzi) {
      for (const w of HSK) {
        if (w.w.startsWith(q) || w.w.includes(q)) push(w.w, w.p, w.l, glossFor(bare(w.p)));
        if (results.length >= limit) break;
      }
    } else {
      for (const w of HSK) {
        const b = bare(w.p);
        if (b === qBare || b.startsWith(qBare)) push(w.w, w.p, w.l, glossFor(b));
        if (results.length >= limit) break;
      }
      if (results.length < limit) {
        const pinyins = [];
        for (const t of Object.keys(REV)) {
          if (t.startsWith(q) || t.includes(q)) {
            for (const p of REV[t]) if (!pinyins.includes(p)) pinyins.push(p);
          }
        }
        for (const p of pinyins) {
          const v = DEFS[p];
          const i = v ? v.indexOf('|') : -1;
          const word = i >= 0 ? v.slice(0, i) : '';
          let pn = p;
          let lvl = 0;
          for (const w of HSK) if (bare(w.p) === p) { pn = w.p; lvl = w.l; break; }
          push(word, pn, lvl, i >= 0 ? v.slice(i + 1) : '');
          if (results.length >= limit) break;
        }
      }
    }
    return results;
  }
})();
