/**
 * HskDb — wrapper IndexedDB per il vocabolario HSK.
 * Crea gli store secondo schema.js e popola con il campione se vuoto.
 * Espone globalmente `PinynHskDb`.
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
        if (!db.objectStoreNames.contains('correction_cache')) {
          db.createObjectStore('correction_cache', { keyPath: 'input' });
        }
        if (!db.objectStoreNames.contains('user_stats')) {
          db.createObjectStore('user_stats', { keyPath: 'id' });
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

  let statSeq = 0;

  /** Registra un evento utente (correzione, ignore, accento, ecc.). */
  async function recordStat(entry) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('user_stats', 'readwrite');
      tx.objectStore('user_stats').put({
        id: Date.now() + '-' + (++statSeq),
        type: entry.type || 'event',
        token: entry.token || null,
        suggestion: entry.suggestion || null,
        level: entry.level == null ? null : entry.level,
        timestamp: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Legge tutti gli eventi registrati. */
  async function getStats() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('user_stats', 'readonly');
      const req = tx.objectStore('user_stats').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  root.PinynHskDb = { getDb, seed, countWords, recordStat, getStats };
})(typeof globalThis !== 'undefined' ? globalThis : this);
