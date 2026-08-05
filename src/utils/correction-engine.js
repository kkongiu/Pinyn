/**
 * CorrectionEngine — correzione contestuale, segmentazione e accentazione.
 * Usa:
 *  - distanza di edit (Levenshtein) vs dizionario sillabe
 *  - bigrammi pinyin derivati dal vocabolario HSK (+ frasi comuni)
 *  - filtro HSK: parola suggerita solo se livello <= livello selezionato + 1
 *  - indice parole HSK (pinyin -> toni) per l'accentazione automatica
 *  - segmentazione DP di parole senza spazi (nihao -> ni hao)
 * Il dataset può essere in formato esteso {word,pinyin_numbers,level} o
 * compatto {w,p,l}. Espone globalmente `PinynCorrectionEngine`.
 */
(function (root) {
  'use strict';

  const Levenshtein = root.PinynLevenshtein;
  const PU = root.PinynUtils;

  // Frasi comuni ad alto valore che non derivano dal vocabolario
  const COMMON_SEQUENCES = [
    ['ni', 'hao'],
    ['zai', 'jian'],
    ['xie', 'xie'],
    ['bu', 'ke', 'qi'],
    ['wo', 'shi'],
    ['ta', 'shi'],
    ['wo', 'men'],
    ['ni', 'men'],
    ['yi', 'qian'],
    ['yi', 'hou'],
  ];

  function normWord(w) {
    return {
      word: w.word || w.w || '',
      pinyin_numbers: w.pinyin_numbers || w.p || '',
      level: w.level || w.l || 9,
      rank: w.rank || w.r || 999999,
    };
  }

  function stripTones(numbers) {
    return (numbers || '').toLowerCase().replace(/v/g, 'ü').replace(/[0-5]/g, '').trim();
  }

  function buildBigrams(words) {
    const map = new Map();
    const add = (a, b) => {
      if (!a || !b) return;
      const k = a + ' ' + b;
      map.set(k, (map.get(k) || 0) + 1);
    };
    for (const w of words) {
      const syls = stripTones(normWord(w).pinyin_numbers).split(/\s+/).filter(Boolean);
      for (let i = 1; i < syls.length; i++) add(syls[i - 1], syls[i]);
    }
    for (const seq of COMMON_SEQUENCES) {
      for (let i = 1; i < seq.length; i++) add(seq[i - 1], seq[i]);
    }
    return map;
  }

  function createEngine(options) {
    options = options || {};
    const syllables = options.syllables || new Set();
    let words = (options.hskWords || []).map(normWord);
    let hskLevel = options.hskLevel == null ? 9 : options.hskLevel;
    let bigrams = options.bigrams || buildBigrams(words);
    const maxSyllableLen = Math.max(1, ...[...syllables].map((s) => s.length));

    // parola (bare, con spazi o compatto) -> pinyin_numbers
    const wordIndex = new Map();
    const wordIndexCompact = new Map();
    // bare syllable -> { tone: count }
    const toneFreq = new Map();
    let hskSet = buildHskSet(words, hskLevel);
    // cache per il match parola intera (compatta)
    let wordCompacts = [];

    function indexWords() {
      wordIndex.clear();
      wordIndexCompact.clear();
      toneFreq.clear();
      wordCompacts = [];
      for (const w of words) {
        const numbers = (w.pinyin_numbers || '').trim();
        if (!numbers) continue;
        const bares = stripTones(numbers).split(/\s+/).filter(Boolean);
        const key = bares.join(' ');
        const keyCompact = bares.join('');
        if (bares.length > 0) {
          if (!wordIndex.has(key)) wordIndex.set(key, numbers);
          if (!wordIndexCompact.has(keyCompact)) wordIndexCompact.set(keyCompact, numbers);
          wordCompacts.push({ compact: keyCompact, numbers, level: w.level, rank: w.rank });
        }
        for (const b of bares) {
          if (!toneFreq.has(b)) toneFreq.set(b, {});
        }
        const nums = numbers.toLowerCase().split(/\s+/).filter(Boolean);
        for (let i = 0; i < bares.length; i++) {
          const m = nums[i] && nums[i].match(/([0-5])$/);
          const t = m ? m[1] : '0';
          const freq = toneFreq.get(bares[i]);
          freq[t] = (freq[t] || 0) + 1;
        }
      }
    }

    function buildHskSet(wordList, level) {
      const set = new Set();
      for (const w of wordList) {
        if (w.level <= level + 1) {
          stripTones(w.pinyin_numbers).split(/\s+/).forEach((s) => { if (s) set.add(s); });
        }
      }
      return set;
    }

    function setLevel(level) {
      hskLevel = level;
      hskSet = buildHskSet(words, hskLevel);
    }

    function setWords(wordList) {
      words = (wordList || []).map(normWord);
      bigrams = buildBigrams(words);
      indexWords();
      hskSet = buildHskSet(words, hskLevel);
    }

    indexWords();

    function bigramScore(prev, cand) {
      if (!prev) return 0;
      return bigrams.get(prev + ' ' + cand) || 0;
    }

    /**
     * @param {string} bare  sillaba senza tono da correggere
     * @param {string|null} prev  sillaba valida precedente (contesto)
     * @param {number} [maxDist]
     * @returns {string[]} suggerimenti ordinati
     */
    function rankSuggestions(bare, prev, maxDist) {
      maxDist = maxDist == null ? (bare.length >= 4 ? 2 : 1) : maxDist;
      if (bare.length < 2) return [];

      const cands = [];
      for (const s of syllables) {
        if (Math.abs(s.length - bare.length) > maxDist) continue;
        const d = Levenshtein.distance(s, bare);
        if (d <= maxDist) {
          const score =
            d * 10 -
            bigramScore(prev, s) * 3 -
            (hskSet.has(s) ? 1 : 0);
          cands.push({ syllable: s, score });
        }
      }
      cands.sort((x, y) => x.score - y.score);
      return cands.slice(0, 5).map((c) => c.syllable);
    }

    /**
     * Segmentazione di una stringa latina in sillabe valide (DP).
     * @returns {string[]|null} es. "nihao" -> ["ni","hao"]
     */
    function segment(bare) {
      if (!bare) return null;
      const best = new Array(bare.length + 1).fill(null);
      best[0] = [];
      const maxLen = maxSyllableLen;
      for (let i = 1; i <= bare.length; i++) {
        for (let l = maxLen; l >= 1; l--) {
          if (l > i) continue;
          const s = bare.slice(i - l, i);
          if (syllables.has(s) && best[i - l]) {
            best[i] = best[i - l].concat(s);
            break;
          }
        }
      }
      return best[bare.length];
    }

    /**
     * Accento "più probabile" per una sillaba senza tono, dalla frequenza
     * nel vocabolario HSK. Ritorna la sillaba accentuata o l'originale.
     */
    function accentSingle(syl) {
      const freq = toneFreq.get(syl);
      if (!freq) return syl;
      let bestTone = null;
      let bestCount = 0;
      for (const t of Object.keys(freq)) {
        if (freq[t] > bestCount) { bestCount = freq[t]; bestTone = t; }
      }
      if (!bestTone || bestTone === '0') return syl;
      return PU.toToneMark(syl + bestTone);
    }

    /**
     * Applica gli accenti a una frase di sillabe senza tono, usando prima il
     * match con parole HSK e poi l'accento per sillaba.
     * @param {string[]} bares
     * @returns {string[]} stesso numero di elementi
     */
    function addAccentsToPhrase(bares) {
      const out = [];
      const L = bares.length;
      let i = 0;
      while (i < L) {
        let matched = null;
        for (let len = Math.min(6, L - i); len >= 2; len--) {
          const slice = bares.slice(i, i + len);
          const numbers = wordIndex.get(slice.join(' ')) || wordIndexCompact.get(slice.join(''));
          if (numbers) {
            const parts = numbers.toLowerCase().split(/\s+/).filter(Boolean);
            if (parts.length === len) { matched = { len, parts }; break; }
          }
        }
        if (matched) {
          for (const p of matched.parts) out.push(PU.toToneMark(p));
          i += matched.len;
        } else {
          out.push(accentSingle(bares[i]));
          i++;
        }
      }
      return out;
    }

    /**
     * Match a livello di PAROLA: confronta la stringa senza spazi (es.
     * "zonguo") con il pinyin compatto delle parole HSK (≤ livello+1).
     * @returns {string[]} es. ["zhōng guó"]
     */
    function findWordSuggestions(bare, maxDist) {
      maxDist = maxDist == null ? 2 : maxDist;
      if (bare.length < 3) return [];
      const out = [];
      const seen = new Set();
      const first = bare[0];
      for (const wc of wordCompacts) {
        if (wc.level > hskLevel + 1) continue;
        if (wc.compact[0] !== first) continue; // typo raramente cambia la prima lettera
        if (Math.abs(wc.compact.length - bare.length) > maxDist) continue;
        const d = Levenshtein.distance(wc.compact, bare);
        if (d <= maxDist && !seen.has(wc.numbers)) {
          seen.add(wc.numbers);
          const spaced = wc.numbers
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean)
            .map((n) => PU.toToneMark(n))
            .join(' ');
          out.push({ text: spaced, distance: d, level: wc.level, rank: wc.rank });
        }
      }
      // ordina: distanza, poi livello (più basso = più base per lo studente)
      out.sort((a, b) => a.distance - b.distance || a.level - b.level);
      return out.slice(0, 4).map((o) => o.text);
    }

    return {
      rankSuggestions,
      segment,
      findWordSuggestions,
      accentSingle,
      addAccentsToPhrase,
      bigramScore,
      setLevel,
      setWords,
      get words() { return words; },
      get bigrams() { return bigrams; },
      get toneFreq() { return toneFreq; },
    };
  }

  root.PinynCorrectionEngine = { createEngine, buildBigrams };
})(typeof globalThis !== 'undefined' ? globalThis : this);
