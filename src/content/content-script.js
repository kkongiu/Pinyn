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
  const hskWords = window.__PINYN_HSK || [];

  // Engine condiviso (i detector lo referenziano: i cambi di livello si
  // propagano a tutti senza riattaccare i campi).
  const engine = PinynCorrectionEngine.createEngine({
    syllables: syllableSet,
    hskWords,
    hskLevel: 3,
  });

  let autoAccentEnabled = false;
  let insertHanzi = false;

  chrome.storage.sync.get({ hskLevel: 3, autoAccent: false, hanzi: false }, (data) => {
    engine.setLevel(Number(data.hskLevel) || 3);
    autoAccentEnabled = !!data.autoAccent;
    insertHanzi = !!data.hanzi;
    propagateOptions();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
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

  function propagateOptions() {
    allHandles.forEach((handle) => {
      if (handle && typeof handle.setAutoAccent === 'function') {
        handle.setAutoAccent(autoAccentEnabled);
      }
      if (handle && typeof handle.setInsertHanzi === 'function') {
        handle.setInsertHanzi(insertHanzi);
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

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'PC_SET_ENABLED') {
      applyEnabled(!!msg.enabled);
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'PC_GET_SELECTION') {
      const sel = window.getSelection();
      const text = (sel && sel.toString() || '').trim();
      sendResponse({ selection: text.slice(0, 200) });
    }
  });
})();
