/**
 * CustomTerms — dizionario utente (termini mancanti).
 * Convalida, conversione nel formato compatto HSK e applicazione nei
 * dati globali del content script (__PINYN_HSK, __PINYN_DEFS,
 * __PINYN_REVERSE). Modulo UMD condiviso tra popup e content script.
 *
 * Termine: { hanzi, pinyin, gloss?, en? }
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinynCustomTerms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const CJK = /^[\u3400-\u9fff]{1,10}$/;

  /** Segmenta una stringa di sillabe COMPATTA in sillabe valide (DP, copertura totale). */
  function segmentSyllables(bare, syllableSet) {
    const n = bare.length;
    const best = new Array(n + 1).fill(null);
    best[0] = [];
    let maxLen = 0;
    for (const s of syllableSet) if (s.length > maxLen) maxLen = s.length;
    for (let i = 1; i <= n; i++) {
      for (let l = maxLen; l >= 1; l--) {
        if (l > i) continue;
        const s = bare.slice(i - l, i);
        if (syllableSet.has(s) && best[i - l]) { best[i] = best[i - l].concat(s); break; }
      }
    }
    return best[n];
  }

  /**
   * Normalizza un pinyin compatto in forma SPAZIATA preservando i toni
   * originali (es. "xǐhuān" -> "xǐ huān", "moka" -> "mo ka").
   * Ritorna null se i confini non si allineano.
   */
  function spaceOut(pinyin, syllables, PU) {
    let rest = pinyin;
    const parts = [];
    for (const sb of syllables) {
      let p = null;
      for (let i = 1; i <= rest.length; i++) {
        if (PU.stripTone(rest.slice(0, i)) === sb) { p = rest.slice(0, i); break; }
      }
      if (p == null) return null;
      parts.push(p);
      rest = rest.slice(p.length);
    }
    return parts.join(' ');
  }

  /**
   * Valida un termine. Ritorna {ok, error} o {ok:true, value}.
   * Il pinyin può essere spaziato ("xǐ huān") o compatto ("xǐhuān", "moka"):
   * i token non-sillaba vengono segmentati in sillabe valide.
   * @param {{hanzi:string,pinyin:string,gloss?:string,en?:string}} t
   * @param {Set<string>} syllableSet sillabe valide
   */
  function validateTerm(t, syllableSet) {
    const hanzi = String((t && t.hanzi) || '').trim();
    const pinyin = String((t && t.pinyin) || '').trim();
    const gloss = String((t && t.gloss) || '').trim();
    const en = String((t && t.en) || '').trim();
    if (!hanzi) return { ok: false, error: 'Inserisci i caratteri cinesi (hanzi).' };
    if (!CJK.test(hanzi)) return { ok: false, error: 'Hanzi non validi (1-10 caratteri cinesi).' };
    if (!pinyin) return { ok: false, error: 'Inserisci il pinyin.' };

    const PU = root.PinynUtils;
    let tokens;
    if (PU) tokens = PU.tokenize(pinyin).filter((x) => x.isLatin).map((x) => x.text);
    else tokens = String(pinyin).toLowerCase().split(/[^a-zü]+/).filter(Boolean);
    if (!tokens.length) return { ok: false, error: 'Pinyin non valido.' };

    let normalized = pinyin;
    const check = (s) => !syllableSet || syllableSet.has(s);
    for (const tok of tokens) {
      const bare = PU ? PU.stripTone(tok) : tok;
      if (check(bare)) continue; // sillaba singola valida
      // token compatto multi-sillaba: prova a segmentarlo
      const seg = segmentSyllables(bare, syllableSet);
      if (!seg || seg.join('') !== bare || seg.some((s) => s.length < 2)) {
        return { ok: false, error: 'Sillaba non valida: "' + bare + '".' };
      }
      if (PU) {
        const spaced = spaceOut(tok, seg, PU);
        if (!spaced) return { ok: false, error: 'Sillaba non valida: "' + bare + '".' };
        normalized = normalized.replace(tok, spaced);
      }
    }

    return { ok: true, value: { hanzi, pinyin: normalized, gloss, en } };
  }

  /** Termine -> voce compatta HSK {w,p,l}. Livello 0 = sempre accettato. */
  function toHskEntry(term) {
    return { w: term.hanzi, p: term.pinyin, l: 0 };
  }

  /** Pinyin senza toni, compatto (es. "ni3 hao3" -> "nihao"). */
  function bareOf(pinyin, PU) {
    PU = PU || root.PinynUtils;
    if (!PU) return String(pinyin || '').toLowerCase().replace(/[0-5]/g, '').replace(/\s+/g, '');
    return PU.stripTone(pinyin).replace(/[0-5]/g, '').replace(/\s+/g, '');
  }

  /**
   * Applica i termini ai dati globali.
   * Idempotente: sostituisce __PINYN_HSK con base + termini; setta defs;
   * appende ai reverse. In caso di collisione su defs salva l'originale
   * in restore per ripristinarlo alla rimozione.
   * @param {Array<object>} baseHsk copia base del vocabolario compatto
   * @param {Array<object>} terms termini {hanzi,pinyin,gloss,en}
   */
  function applyToGlobals(baseHsk, terms, restore) {
    const hask = root.__PINYN_HSK;
    root.__PINYN_HSK = baseHsk.concat(terms.map(toHskEntry));

    const defs = root.__PINYN_DEFS || (root.__PINYN_DEFS = {});
    for (const t of terms) {
      const bare = bareOf(t.pinyin);
      if (!bare) continue;
      const key = 'd:' + bare;
      if (!(key in restore)) restore[key] = defs[bare];
      defs[bare] = t.hanzi + '|' + t.gloss;
    }

    const rev = root.__PINYN_REVERSE || (root.__PINYN_REVERSE = {});
    for (const t of terms) {
      if (!t.en) continue;
      const bare = bareOf(t.pinyin);
      if (!bare) continue;
      const key = 'r:' + t.en.toLowerCase();
      const orig = rev[t.en.toLowerCase()];
      if (!(key in restore)) restore[key] = orig === undefined ? null : orig.slice();
      const list = rev[t.en.toLowerCase()] || (rev[t.en.toLowerCase()] = []);
      if (!list.includes(bare)) list.push(bare);
    }
  }

  /**
   * Rimuove un termine dai dati globali (usato alla cancellazione).
   * @param {Array<object>} terms rimanenti (dopo la rimozione)
   * @param {object} restore mappa backup di applyToGlobals
   */
  function pruneGlobals(baseHsk, terms, restore) {
    applyToGlobals(baseHsk, terms, restore);
    // ripristina le chiavi che non appartengono più a termini correnti
    const currentD = new Set(terms.map((t) => 'd:' + bareOf(t.pinyin)));
    const currentR = new Set(terms.filter((t) => t.en).map((t) => 'r:' + t.en.toLowerCase()));
    for (const k of Object.keys(restore)) {
      if (k[0] === 'd' && !currentD.has(k)) {
        const bare = k.slice(2);
        if (restore[k] === undefined) delete root.__PINYN_DEFS[bare];
        else root.__PINYN_DEFS[bare] = restore[k];
        delete restore[k];
      } else if (k[0] === 'r' && !currentR.has(k)) {
        const en = k.slice(2);
        const list = root.__PINYN_REVERSE && root.__PINYN_REVERSE[en];
        if (restore[k] === null) { if (root.__PINYN_REVERSE) delete root.__PINYN_REVERSE[en]; }
        else if (root.__PINYN_REVERSE) root.__PINYN_REVERSE[en] = restore[k];
        delete restore[k];
      }
    }
  }

  /** Dimensione approssimata (UTF-8) per il mirror in storage.sync. */
  function sizeBytes(terms) {
    return new Blob([JSON.stringify(terms)]).size || JSON.stringify(terms).length;
  }

  return { validateTerm, toHskEntry, bareOf, segmentSyllables, spaceOut, applyToGlobals, pruneGlobals, sizeBytes };
});
