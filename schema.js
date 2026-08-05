// Database initialization
const DB_NAME = 'PinyinCorrectorDB';
const DB_VERSION = 1;

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    
    // Store per le parole HSK
    const hskStore = db.createObjectStore('hsk_words', { keyPath: 'id' });
    hskStore.createIndex('level', 'level', { unique: false });
    hskStore.createIndex('pinyin', 'pinyin', { unique: false });
    hskStore.createIndex('word', 'word', { unique: false });
    
    // Store per la cache delle correzioni
    const cacheStore = db.createObjectStore('correction_cache', { keyPath: 'input' });
    cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
    
    // Store per le statistiche utente
    const statsStore = db.createObjectStore('user_stats', { keyPath: 'id' });
    statsStore.createIndex('level', 'level', { unique: false });
  };
  
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});