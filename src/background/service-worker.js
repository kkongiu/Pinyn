// Service worker (MV3) — stato + statistiche. Il motore di correzione vive
// nei content script; qui si aggregano gli eventi da IndexedDB per il popup.
importScripts('../utils/translate-parse.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ enabled: true, translate: true });
});

// Scorciatoia da tastiera: Alt+Shift+P (modificabile in chrome://extensions/shortcuts)
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-enabled') return;
  chrome.storage.sync.get({ enabled: true }, (data) => {
    const next = data.enabled === false;
    chrome.storage.sync.set({ enabled: next });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === 'PC_SET_ENABLED') {
    sendResponse({ ok: true });
    return;
  }
  if (msg && msg.type === 'PC_GET_STATS') {
    // il DB è condiviso con i content script
    const open = indexedDB.open('PinyinCorrectorDB', 1);
    open.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('hsk_words')) {
        const s = db.createObjectStore('hsk_words', { keyPath: 'id' });
        s.createIndex('level', 'level', { unique: false });
        s.createIndex('pinyin', 'pinyin', { unique: false });
        s.createIndex('word', 'word', { unique: false });
      }
      if (!db.objectStoreNames.contains('user_stats')) {
        db.createObjectStore('user_stats', { keyPath: 'id' });
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction('user_stats', 'readonly');
        const req = tx.objectStore('user_stats').getAll();
        req.onsuccess = () => sendResponse({ stats: aggregate(req.result) });
        req.onerror = () => sendResponse({ stats: emptyStats() });
      } catch (_) {
        sendResponse({ stats: emptyStats() });
      }
    };
    open.onerror = () => sendResponse({ stats: emptyStats() });
    return true; // risposta asincrona
  }
  if (msg && msg.type === 'PC_TRANSLATE') {
    translate(msg.text, msg.tl)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false, translation: '' }));
    return true; // risposta asincrona
  }
});

// Cache in-memory: evita richieste ripetute per lo stesso testo.
const translateCache = new Map();
const translateCacheMax = 200;

function translate(text, targetLang) {
  const TP = self.PinynTranslateParse;
  const t = String(text || '').trim().slice(0, 500);
  if (!t || !TP) return Promise.resolve({ ok: false, translation: '', lang: '' });
  const tl = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(targetLang || '')) ? targetLang : 'it';
  const key = tl + '|' + t;
  if (translateCache.has(key)) {
    return Promise.resolve(translateCache.get(key));
  }
  return fetch(TP.buildUrl(t, tl))
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then((txt) => {
      const res = TP.parseGtx(txt);
      if (res.ok) {
        translateCache.set(key, res);
        if (translateCache.size > translateCacheMax) {
          translateCache.delete(translateCache.keys().next().value);
        }
      }
      return res;
    });
}

function emptyStats() {
  return { corrections: 0, ignores: 0, accents: 0, tonifies: 0, levels: {} };
}

function aggregate(records) {
  const s = emptyStats();
  for (const r of records || []) {
    if (r.type === 'correction') {
      s.corrections++;
      if (r.level != null) {
        const k = String(Math.floor(r.level));
        s.levels[k] = (s.levels[k] || 0) + 1;
      }
    } else if (r.type === 'ignore') {
      s.ignores++;
    } else if (r.type === 'accent') {
      s.accents++;
    } else if (r.type === 'tonify') {
      s.tonifies++;
    }
  }
  return s;
}
