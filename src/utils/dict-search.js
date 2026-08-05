/**
 * DictSearch — ricerca nel vocabolario HSK (hanzi, pinyin, inglese).
 * Dizionario inverso: una sola casella di ricerca restituisce le parole.
 * Espone globalmente `PinynDict`.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PinynDict = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CJK = /[\u3400-\u9fff]/;

  /** "ni3 hao3" / "nǐ hǎo" -> "ni hao" */
  function bareOf(s) {
    if (!s) return '';
    let out = s.toLowerCase().replace(/v/g, 'ü');
    // rimuove i diacritici di tono (per sillaba)
    out = out.replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e')
      .replace(/[īíǐì]/g, 'i').replace(/[ōóǒò]/g, 'o')
      .replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'ü')
      .replace(/[0-5]/g, '');
    return out.replace(/\s+/g, ' ').trim();
  }

  /**
   * @param {Array} words voci HSK {word,pinyin,pinyin_numbers,level,pos,rank,definitions}
   * @returns {{entries:Array}}
   */
  function buildIndex(words) {
    const entries = (words || []).map((w) => {
      const defs = (w.definitions || []).filter(Boolean);
      return {
        word: w.word || '',
        pinyin: w.pinyin || '',
        pinyin_numbers: w.pinyin_numbers || '',
        bare: bareOf(w.pinyin_numbers),
        level: w.level,
        pos: w.pos || '',
        rank: w.rank || 0,
        definitions: defs,
        defsLower: defs.map((d) => d.toLowerCase()),
      };
    });
    return { entries };
  }

  /**
   * @param {string} query
   * @param {{entries:Array}} index
   * @param {number} [limit]
   * @returns {Array} risultati {word,pinyin,level,pos,definitions,score}
   */
  function search(query, index, limit) {
    query = (query || '').trim().toLowerCase();
    if (!query || !index) return [];
    const hasHanzi = CJK.test(query);
    const qBare = bareOf(query).replace(/\s+/g, '');
    const results = [];

    for (const e of index.entries) {
      let score = 0;
      if (hasHanzi) {
        if (e.word === query) score = 100;
        else if (e.word.startsWith(query)) score = 85;
        else if (e.word.includes(query)) score = 65;
      } else {
        const bareCompact = e.bare.replace(/\s+/g, '');
        if (bareCompact === qBare) score = 95;
        else if (bareCompact.startsWith(qBare)) score = 75;
        else if (e.bare.includes(query)) score = 55;
        else if (qBare.length >= 2 && bareCompact.includes(qBare)) score = 45;
        if (score < 40) {
          for (const d of e.defsLower) {
            if (d === query) { score = 40; break; }
            if (query.length >= 3 && d.includes(query)) { score = Math.max(score, 25); }
          }
        }
      }
      if (score > 0) {
        results.push({
          word: e.word,
          pinyin: e.pinyin,
          pinyin_numbers: e.pinyin_numbers,
          level: e.level,
          pos: e.pos,
          definitions: e.definitions,
          score,
        });
      }
    }

    results.sort((a, b) =>
      b.score - a.score ||
      (a.level || 9) - (b.level || 9) ||
      (a.rank || 1e9) - (b.rank || 1e9)
    );
    return results.slice(0, limit || 30);
  }

  return { buildIndex, search, bareOf, isHanzi: (s) => CJK.test(s) };
});
