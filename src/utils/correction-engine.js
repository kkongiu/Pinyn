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

  // a è meglio di b se livello più basso, o pari livello con rank più basso
  function better(a, b) {
    if (a.level !== b.level) return a.level < b.level;
    return (a.rank || 999999) < (b.rank || 999999);
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
    // chiave (bare con spazi) -> livello minimo della parola
    const pinyinLevelMap = new Map();
    // predictor opzionale (rete toni): (bares[]) -> Int8Array di toni 0-4
    let predictor = (options && options.predictTones) || null;

    function setTonePredictor(fn) {
      predictor = fn || null;
    }

    function indexWords() {
      wordIndex.clear();
      wordIndexCompact.clear();
      toneFreq.clear();
      wordCompacts = [];
      pinyinLevelMap.clear();
      for (const w of words) {
        const numbers = (w.pinyin_numbers || '').trim();
        if (!numbers) continue;
        const bares = stripTones(numbers).split(/\s+/).filter(Boolean);
        const key = bares.join(' ');
        const keyCompact = bares.join('');
        if (bares.length > 0) {
          const entry = { numbers, level: w.level, rank: w.rank };
          // tieni la parola PIÙ COMUNE (livello più basso, poi rank)
          const cur = wordIndex.get(key);
          if (!cur || better(entry, cur)) wordIndex.set(key, entry);
          const curC = wordIndexCompact.get(keyCompact);
          if (!curC || better(entry, curC)) wordIndexCompact.set(keyCompact, entry);
          wordCompacts.push({ compact: keyCompact, numbers, level: w.level, rank: w.rank });
          const curL = pinyinLevelMap.get(key) || 999;
          if (w.level < curL) pinyinLevelMap.set(key, w.level);
        }
        for (const b of bares) {
          if (!toneFreq.has(b)) toneFreq.set(b, {});
        }
        const nums = numbers.toLowerCase().split(/\s+/).filter(Boolean);
        // peso per livello: le parole base (L1-L3) contano molto di più
        const weight = Math.pow(0.5, Math.min(w.level, 8) - 1);
        for (let i = 0; i < bares.length; i++) {
          const m = nums[i] && nums[i].match(/([0-5])$/);
          const t = m ? (m[1] === '5' ? '0' : m[1]) : '0'; // 5 = neutro (0)
          const freq = toneFreq.get(bares[i]);
          freq[t] = (freq[t] || 0) + weight;
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
          const entry = wordIndex.get(slice.join(' ')) || wordIndexCompact.get(slice.join(''));
          if (entry) {
            const parts = entry.numbers.toLowerCase().split(/\s+/).filter(Boolean);
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

    /**
     * Segmenta una frase di sillabe in parole del dizionario (maximal munch)
     * e restituisce segmenti accentati. Le parole vengono UNITE senza spazi
     * (es. "zhong guo" -> {count:2, text:"zhōngguó"}).
     * @param {string[]} bares
     * @returns {{count:number,text:string}[]}
     */
    function accentRun(bares) {
      const out = [];
      const L = bares.length;
      let i = 0;
      // toni contestuali dalla rete (per il fallback per-sillaba)
      let ctxTones = null;
      if (predictor) {
        try { ctxTones = predictor(bares); } catch (_) { ctxTones = null; }
      }
      while (i < L) {
        // 1) match parola multi-sillaba (len >= 2)
        let match = null;
        for (let len = Math.min(6, L - i); len >= 2; len--) {
          const slice = bares.slice(i, i + len);
          const entry = wordIndex.get(slice.join(' ')) || wordIndexCompact.get(slice.join(''));
          if (entry) { match = { len, numbers: entry.numbers }; break; }
        }
        if (match) {
          const text = match.numbers
            .toLowerCase()
            .replace(/v/g, 'ü')
            .split(/\s+/)
            .filter(Boolean)
            .map((n) => PU.toToneMark(n))
            .join('');
          out.push({ count: match.len, text });
          i += match.len;
          continue;
        }
        // 2) singola sillaba: se NON è una sillaba valida ma è una parola
        //    compatta senza spazi (es. "zhongguo") -> parola accentata
        const cur = bares[i];
        if (!syllables.has(cur)) {
          const entry = wordIndexCompact.get(cur);
          if (entry) {
            const text = entry.numbers
              .toLowerCase()
              .replace(/v/g, 'ü')
              .split(/\s+/)
              .filter(Boolean)
              .map((n) => PU.toToneMark(n))
              .join('');
            out.push({ count: 1, text });
            i++;
            continue;
          }
        }
        // 3) altrimenti accento per sillaba: ibrido.
        //    - euristica se il tono dominante è affidabile (share alto)
        //    - rete dei toni se la sillaba è ambigua
        if (syllables.has(cur)) {
          const choice = accentChoice(cur);
          const CONF = 0.65;
          let text;
          if (choice.share >= CONF && choice.tone >= 0) {
            text = PU.toToneMark(cur + choice.tone);
          } else if (ctxTones && ctxTones[i] != null && ctxTones[i] >= 0 && ctxTones[i] <= 4) {
            text = PU.toToneMark(cur + ctxTones[i]);
          } else {
            text = accentSingle(cur);
          }
          out.push({ count: 1, text });
        } else {
          out.push({ count: 1, text: accentSingle(cur) });
        }
        i++;
      }
      return out;
    }

    /**
     * Ton + confidenza (share del tono più frequente, pesato per livello).
     * tone: 0=neutro,1-4. Ritorna { tone, share }.
     */
    function accentChoice(bare) {
      const freq = toneFreq.get(bare);
      if (!freq) return { tone: 0, share: 0 };
      let total = 0;
      for (const k of Object.keys(freq)) total += freq[k];
      if (!total) return { tone: 0, share: 0 };
      let bestTone = 0;
      let bestCount = -1;
      for (const k of Object.keys(freq)) {
        if (freq[k] > bestCount) { bestCount = freq[k]; bestTone = Number(k); }
      }
      return { tone: bestTone, share: bestCount / total };
    }

    /**
     * Tutte le varianti di tono di una sillaba (ordinate per peso), per il
     * menu di selezione. Es. "he" -> ["hé","hē","hè"]. Il neutro (0) = bare.
     * @param {string} bare
     * @param {number} [minShare] share minimo (default 1%)
     */
    function toneVariants(bare, minShare) {
      minShare = minShare == null ? 0.01 : minShare;
      const freq = toneFreq.get(bare);
      if (!freq) return [];
      let total = 0;
      for (const k of Object.keys(freq)) total += freq[k];
      if (!total) return [];
      const keys = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
      const out = [];
      for (const k of keys) {
        if (freq[k] / total < minShare) continue;
        out.push(PU.toToneMark(bare + k));
      }
      return out;
    }

    /**
     * Un tono è "sospetto" se la sua frequenza per quella sillaba nel
     * vocabolario HSK è molto bassa (< 6%): probabile errore di tono.
     */
    function toneSuspect(bare, tone) {
      const freq = toneFreq.get(bare);
      if (!freq) return false;
      let total = 0;
      for (const k of Object.keys(freq)) total += freq[k];
      if (!total) return false;
      const share = (freq[tone] || 0) / total;
      return share < 0.01;
    }

    /**
     * Livello HSK della parola corrispondente a una stringa pinyin
     * (accenti o numeri, es. "zhōng guó" o "hao"). Ritorna null se ignota.
     */
    function pinyinLevel(pinyinStr) {
      if (!pinyinStr) return null;
      const nums = pinyinStr
        .toLowerCase()
        .replace(/v/g, 'ü')
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => PU.toToneNumber(s))
        .join(' ');
      const bare = stripTones(nums);
      const lvl = pinyinLevelMap.get(bare);
      return lvl == null ? null : lvl;
    }

    return {
      rankSuggestions,
      segment,
      findWordSuggestions,
      accentSingle,
      accentChoice,
      toneVariants,
      addAccentsToPhrase,
      accentRun,
      setTonePredictor,
      toneSuspect,
      pinyinLevel,
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
