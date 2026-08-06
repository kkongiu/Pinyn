/**
 * HskDb — wrapper IndexedDB per il vocabolario HSK.
 * Crea lo store hsk_words e popola con il campione se vuoto.
 * Espone globalmente `PinynHskDb`.
 *
 * Nota: le statistiche utente NON vivono qui ma in chrome.storage.local
 * (`pcStats`, aggregato dai content script): in MV3 il service worker usa una
 * partizione IndexedDB separata da quella dei content script, quindi uno store
 * condiviso per le statistiche non è affidabile.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'PinyinCorrectorDB';
  const DB_VERSION = 1;

  function getDb() {
    return new Promise((resolve, reject) => {
      const open = root.indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('hsk_words')) {
          const s = db.createObjectStore('hsk_words', { keyPath: 'id' });
          s.createIndex('level', 'level', { unique: false });
          s.createIndex('pinyin', 'pinyin', { unique: false });
          s.createIndex('word', 'word', { unique: false });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  /** Popola lo store solo se vuoto. Ritorna true se ha inserito. */
  async function seed(words) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('hsk_words', 'readwrite');
      const store = tx.objectStore('hsk_words');
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result > 0) return resolve(false);
        for (const w of words) store.put(w);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function countWords() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('hsk_words', 'readonly');
      const req = tx.objectStore('hsk_words').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  root.PinynHskDb = { getDb, seed, countWords };
})(typeof globalThis !== 'undefined' ? globalThis : this);
