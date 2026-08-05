// Service worker (MV3) — stato + statistiche. Il motore di correzione vive
// nei content script; qui si aggregano gli eventi da IndexedDB per il popup.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ enabled: true });
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
});

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
