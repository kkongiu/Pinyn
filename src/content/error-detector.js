/**
 * ErrorDetector — valida i token pinyin contro il dizionario di sillabe.
 * Espone globalmente `PinynErrorDetector`.
 */
(function (root) {
  'use strict';
  const PinynUtils = root.PinynUtils;

  function createDetector(syllableSet, options) {
    const valid = syllableSet || new Set();
    const engine = (options && options.engine) || null;
    const ignoreTokens = new Set((options && options.ignore) || []);

    function ignore(token) {
      ignoreTokens.add(PinynUtils.stripTone(token));
      return true;
    }

    /**
     * @param {string} text
     * @returns {{token:string,start:number,end:number,isError:boolean,kind:'error'|'tone',suggestions:string[]}[]}
     */
    function scan(text) {
      const results = [];
      const tokens = PinynUtils.tokenize(text);
      let offset = 0;
      let prev = null; // ultima sillaba valida (contesto)
      for (const t of tokens) {
        const start = offset;
        const end = offset + t.text.length;
        offset = end;

        if (!t.isLatin) continue;

        const bare = PinynUtils.stripTone(t.text);
        if (ignoreTokens.has(bare)) continue;
        const validBare = valid.has(bare);
        // sillabe standalone valide
        if (validBare) {
          prev = bare;
          // tono sospetto: sillaba valida ma con tono raro nel vocabolario
          if (engine && (PinynUtils.isToneNumbered(t.text) || PinynUtils.hasToneMark(t.text))) {
            const { tone } = PinynUtils.extractTone(t.text);
            if (engine.toneSuspect(bare, tone)) {
              results.push({
                token: t.text,
                start,
                end,
                isError: false,
                kind: 'tone',
                suggestions: toneSuggestions(bare, tone),
              });
            }
          }
          continue;
        }

        // token multi-sillaba senza spazi (es. "kāfēi", "hele", "xuexiao"):
        // è pinyin valido se si segmenta in sillabe valide (copertura totale).
        // Esclude sillabe di una sola lettera (a/e/o): compaiono solo in
        // refusi/segmentationi spurie (es. "xuexioa" -> xue+xi+o+a).
        if (engine) {
          const seg = engine.segment(bare);
          if (seg && seg.join('') === bare && seg.every((s) => s.length >= 2)) {
            prev = seg[seg.length - 1];
            continue;
          }
        }

        // errore: token latino non riconosciuto come sillaba pinyin
        results.push({
          token: t.text,
          start,
          end,
          isError: true,
          kind: 'error',
          suggestions: suggest(bare, prev),
        });
      }
      return results;
    }

    /** Suggerimenti per un tono sospetto: la forma con il tono più frequente. */
    function toneSuggestions(bare, givenTone) {
      const out = [];
      if (engine) {
        const acc = engine.accentSingle(bare);
        const accTone = PinynUtils.extractTone(acc).tone;
        if (accTone > 0 && accTone !== givenTone) out.push(acc);
        if (out.length === 0 && acc) out.push(acc);
      }
      return out.slice(0, 3);
    }

    /** Suggerimenti: parola intera -> segmentazione -> sillaba (engine). */
    function suggest(bare, prev, maxDist) {
      const out = [];
      const seen = new Set();
      const push = (s) => {
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
      };

      if (engine) {
        // 1. segmentazione (nihao -> ni hao): correzione esatta, solo spazi
        const seg = engine.segment(bare);
        if (seg && seg.length >= 2 && seg.join('') === bare) {
          push(seg.join(' '));
        }
        // 2. match a livello di parola (zonguo -> zhōng guó)
        engine.findWordSuggestions(bare, 2).forEach(push);
        // 3. sillaba singola contestuale
        engine.rankSuggestions(bare, prev, maxDist).forEach(push);
      } else {
        levenshteinSuggest(bare, maxDist).forEach(push);
      }
      return out.slice(0, 6);
    }

    /**
     * Token pinyin validi ma senza accento per cui il dizionario conosce il
     * tono. Ritorna [{start,end,token,accent}].
     */
    function accentable(text) {
      const out = [];
      if (!engine) return out;
      const tokens = PinynUtils.tokenize(text);
      let offset = 0;
      for (const t of tokens) {
        const start = offset;
        const end = offset + t.text.length;
        offset = end;
        if (!t.isLatin) continue;
        if (PinynUtils.isToneNumbered(t.text)) continue; // ha già il numero
        if (PinynUtils.hasToneMark(t.text)) continue;    // ha già l'accento
        const bare = PinynUtils.stripTone(t.text);
        if (!valid.has(bare)) continue;
        const accent = engine.accentSingle(bare);
        if (accent && accent !== t.text) {
          out.push({ start, end, token: t.text, accent });
        }
      }
      return out;
    }

    function levenshteinSuggest(bare, maxDist) {
      maxDist = maxDist == null ? (bare.length >= 4 ? 2 : 1) : maxDist;
      if (bare.length < 2) return [];
      const out = [];
      const seen = new Set();
      for (const s of valid) {
        if (Math.abs(s.length - bare.length) > maxDist) continue;
        const d = root.PinynLevenshtein.distance(s, bare);
        if (d <= maxDist && !seen.has(s)) {
          seen.add(s);
          out.push({ syllable: s, distance: d });
        }
      }
      out.sort((x, y) => x.distance - y.distance || x.syllable.length - y.syllable.length);
      return out.slice(0, 5).map((o) => o.syllable);
    }

    return { scan, suggest, ignore, accentable, isValid: (s) => valid.has(s) };
  }

  root.PinynErrorDetector = { createDetector };
})(typeof globalThis !== 'undefined' ? globalThis : this);
