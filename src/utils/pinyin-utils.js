/**
 * PinynUtils — utilità pinyin: normalizzazione toni (numeri <-> diacritici)
 * e tokenizzazione del testo digitato.
 * Compatibile browser (globale PinynUtils) e Node (module.exports).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PinynUtils = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE_VOWELS = ['a', 'e', 'i', 'o', 'u', 'ü'];

  const TONED = {
    ā: { base: 'a', tone: 1 }, á: { base: 'a', tone: 2 }, ǎ: { base: 'a', tone: 3 }, à: { base: 'a', tone: 4 },
    ē: { base: 'e', tone: 1 }, é: { base: 'e', tone: 2 }, ě: { base: 'e', tone: 3 }, è: { base: 'e', tone: 4 },
    ī: { base: 'i', tone: 1 }, í: { base: 'i', tone: 2 }, ǐ: { base: 'i', tone: 3 }, ì: { base: 'i', tone: 4 },
    ō: { base: 'o', tone: 1 }, ó: { base: 'o', tone: 2 }, ǒ: { base: 'o', tone: 3 }, ò: { base: 'o', tone: 4 },
    ū: { base: 'u', tone: 1 }, ú: { base: 'u', tone: 2 }, ǔ: { base: 'u', tone: 3 }, ù: { base: 'u', tone: 4 },
    ǖ: { base: 'ü', tone: 1 }, ǘ: { base: 'ü', tone: 2 }, ǚ: { base: 'ü', tone: 3 }, ǜ: { base: 'ü', tone: 4 },
  };

  const MARK = {
    '1': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū', ü: 'ǖ' },
    '2': { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', ü: 'ǘ' },
    '3': { a: 'ǎ', e: 'ě', i: 'ǐ', o: 'ǒ', u: 'ǔ', ü: 'ǚ' },
    '4': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', ü: 'ǜ' },
  };

  // Ordine di collocazione del dittongo del tono (regola pinyin):
  // 1) a, o, e hanno la priorità
  // 2) "iu" -> tono sulla u (qiú), "ui" -> tono sulla i (guǐ)
  // 3) altrimenti i / u / ü
  function toneIndex(syllable) {
    for (const v of ['a', 'o', 'e']) {
      const idx = syllable.indexOf(v);
      if (idx !== -1) return idx;
    }
    const iu = syllable.indexOf('iu');
    if (iu !== -1) return iu + 1; // la 'u'
    const ui = syllable.indexOf('ui');
    if (ui !== -1) return ui + 1; // la 'i'
    for (const v of ['i', 'u', 'ü']) {
      const idx = syllable.indexOf(v);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  /** "nǐ" -> { base: "ni", tone: 3 }; "ni3" -> { base: "ni", tone: 3 } */
  function extractTone(syllable) {
    if (!syllable) return { base: '', tone: 0 };
    const s = syllable.toLowerCase();
    for (const ch of s) {
      if (TONED[ch]) return { base: normalizeVowelV(s.split(ch).join(TONED[ch].base)), tone: TONED[ch].tone };
    }
    const m = s.match(/(\d)$/);
    if (m) return { base: normalizeVowelV(s.slice(0, -1)), tone: parseInt(m[1], 10) };
    return { base: normalizeVowelV(s), tone: 0 };
  }

  /** In pinyin, la "v" da tastiera corrisponde a "ü" (es. lv -> lü). */
  function normalizeVowelV(s) {
    return s.replace(/v/g, 'ü');
  }

  /** "ni" + 3 -> "nǐ" */
  function addToneMark(base, tone) {
    base = normalizeVowelV(base.toLowerCase());
    const t = String(tone);
    if (+tone < 1 || +tone > 4 || !bodyHasVowel(base)) return base;
    const idx = toneIndex(base);
    if (idx === -1) return base;
    const ch = base[idx];
    const replacement = MARK[t][ch] || ch;
    return base.slice(0, idx) + replacement + base.slice(idx + 1);
  }

  function bodyHasVowel(s) {
    return BASE_VOWELS.some((v) => s.includes(v));
  }

  /** "nǐ" -> "ni3" */
  function toToneNumber(syllable) {
    const { base, tone } = extractTone(syllable);
    return tone > 0 ? base + tone : base;
  }

  /** "ni3" -> "nǐ" */
  function toToneMark(syllable) {
    const { base, tone } = extractTone(syllable);
    return addToneMark(base, tone);
  }

  /** Rimuove TUTTI i diacritici di tono (e i numeri): "nǐ hǎo" -> "ni hao". */
  function stripTone(syllable) {
    if (!syllable) return '';
    return normalizeVowelV(syllable.toLowerCase())
      .replace(/[āáǎà]/g, 'a')
      .replace(/[ēéěè]/g, 'e')
      .replace(/[īíǐì]/g, 'i')
      .replace(/[ōóǒò]/g, 'o')
      .replace(/[ūúǔù]/g, 'u')
      .replace(/[ǖǘǚǜ]/g, 'ü')
      .replace(/[0-5]/g, '');
  }

  /** Un token è un candidato pinyin? (solo segmento latino/ü) */
  function isPinyinToken(token) {
    return /^[a-zA-Zü]+$/.test(token) && token.length >= 1;
  }

  /**
   * Suddivide il testo in token preservando il testo non-latino.
   * Una cifra tonale (0-5) finale è parte del token pinyin ("hao3").
   * @returns [{ text, isLatin }]
   */
  function tokenize(text) {
    const tokens = [];
    const re = /[a-zA-Züōóǒòāáǎàēéěèīíǐìūúǔùǖǘǚǜ]+[0-5]?|[^a-zA-Züōóǒòāáǎàēéěèīíǐìūúǔùǖǘǚǜ]+/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      tokens.push({ text: m[0].toLowerCase(), isLatin: /[a-zA-Zü]/.test(m[0]) });
    }
    return tokens;
  }

  /**
   * Converte i toni numerici del testo in diacritici, lasciando intatto il resto.
   * "ni3 hao3" -> "nǐ hǎo"; "ma0" -> "ma".
   */
  function convertToneNumbers(text) {
    return text.replace(/([a-zA-Zü]+)([0-5])\b/gi, (m, base, toneStr) => {
      const tone = parseInt(toneStr, 10);
      if (tone >= 1 && tone <= 4) return addToneMark(base, tone);
      return base; // tono neutro (0/5)
    });
  }

  /** true se il token è un pinyin in formato "hao3" (base + cifra tonale). */
  function isToneNumbered(syllable) {
    return /^[a-zü]+[0-5]$/i.test(syllable);
  }

  /** true se il token contiene già un diacritico di tono (āáǎà…). */
  function hasToneMark(syllable) {
    return /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(syllable);
  }

  return {
    extractTone,
    addToneMark,
    toToneNumber,
    toToneMark,
    stripTone,
    isPinyinToken,
    isToneNumbered,
    hasToneMark,
    tokenize,
    convertToneNumbers,
    toneIndex,
  };
});
