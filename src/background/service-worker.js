// Service worker (MV3) — stato + traduzione. Le statistiche vengono aggregate
// dai content script in chrome.storage.local (`pcStats`) e lette direttamente
// dal popup: il SW non accede a IndexedDB, che in MV3 ha una partizione
// separata da quella dei content script.
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
