/**
 * Stats — aggregazione degli eventi utente (correzioni, ignorati, accenti,
 * tonificazioni, conversioni) per livello HSK.
 *
 * Il conteggio vive in chrome.storage.local (`pcStats`): è l'unico storage
 * condiviso in modo affidabile da tutti i contesti MV3 (content script,
 * popup, options, service worker). IndexedDB non è adatto qui: il service
 * worker usa una partizione separata da quella dei content script.
 *
 * Modulo UMD condiviso tra content script e test.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinynStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATS_KEY = 'pcStats';

  /** Stato vuoto. */
  function empty() {
    return { corrections: 0, ignores: 0, accents: 0, tonifies: 0, converts: 0, levels: {} };
  }

  /** Clona uno stato (senza condividere riferimenti). */
  function clone(stats) {
    const s = stats ? JSON.parse(JSON.stringify(stats)) : empty();
    s.levels = s.levels || {};
    return s;
  }

  /**
   * Applica una lista di eventi a uno stato (read-modify-write per i
   * content script). Non muta l'input: ritorna una copia aggiornata.
   * @param {object|null} stats stato aggregato corrente (o null)
   * @param {Array<object>} entries eventi {type, level?}
   */
  function applyEvents(stats, entries) {
    const s = clone(stats);
    for (const e of entries || []) {
      if (!e || !e.type) continue;
      if (e.type === 'correction') {
        s.corrections++;
        if (e.level != null) {
          const k = String(Math.floor(e.level));
          s.levels[k] = (s.levels[k] || 0) + 1;
        }
      } else if (e.type === 'ignore') {
        s.ignores++;
      } else if (e.type === 'accent') {
        s.accents++;
      } else if (e.type === 'tonify') {
        s.tonifies++;
      } else if (e.type === 'convert') {
        s.converts++;
      }
    }
    return s;
  }

  /** Versione a evento singolo. */
  function applyEvent(stats, entry) {
    return applyEvents(stats, [entry]);
  }

  return { STATS_KEY, empty, clone, applyEvent, applyEvents };
});
