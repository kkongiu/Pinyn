/**
 * GrammarRules — verifica grammaticale base (molto conservativa).
 * Opera sulle parole segmentate di una frase pinyin: ogni parola ha
 * {bare, hanzi}. Usa window.__PINYN_POS per il POS (tag singolo non ambiguo).
 * Ritorna array di messaggi {index, message}. Espone globalmente `PinynGrammar`.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinynGrammar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DEGREE_ADV = new Set(['很', '太', '非常', '特别', '真', '挺']);

  function posOf(hanzi) {
    const pos = root.__PINYN_POS && root.__PINYN_POS[hanzi];
    // solo tag singoli non ambigui (es. "N" ok, "V/N" no)
    return pos && !pos.includes('/') ? pos : null;
  }

  /**
   * @param {Array<{bare:string,hanzi:string}>} words  parole della frase
   * @returns {Array<{index:number,message:string}>}
   */
  function checkGrammar(words) {
    const notes = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1];

      // 1) avverbio di grado + nome (很 + N non è corretto)
      if (next && DEGREE_ADV.has(w.hanzi)) {
        const np = posOf(next.hanzi);
        if (np === 'N') {
          notes.push({ index: i, message: '"' + w.hanzi + '" prima di un nome ("' + next.hanzi + '"): di solito ' + w.hanzi + ' modifica un aggettivo o un verbo.' });
        }
      }

      // 2) 是 + verbo (senza sostantivo dopo)
      if (next && w.hanzi === '是') {
        const vp = posOf(next.hanzi);
        const skip = new Set(['的', '了', '过', '在', '有', '不', '没', '吗', '呢']);
        if (vp === 'V' && !skip.has(next.hanzi)) {
          notes.push({ index: i, message: '"是" davanti al verbo "' + next.hanzi + '": di solito si usa il verbo direttamente ("' + next.hanzi + '…").' });
        }
      }

      // 3) 吗 non a fine frase
      if (w.hanzi === '吗' && i < words.length - 1) {
        notes.push({ index: i, message: '"吗" va alla fine della frase.' });
      }
    }
    return notes;
  }

  return { checkGrammar, posOf };
});
