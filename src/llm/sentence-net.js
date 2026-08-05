/**
 * SentenceNet — LM per la verifica di forma delle frasi pinyin.
 *
 * Modello: MLP a finestra (embedding + hidden + softmax su vocabolario)
 * che predice la parola successiva. Addestrato offline e quantizzato in
 * int8 (vedi ml/). Il punteggio di una frase è la media di -log P(parola|contesto);
 * valori alti = frase insolita.
 *
 * Caricamento lazy di src/data/sentence-net.json (int8, ~1.4MB). Se il
 * caricamento fallisce ritorna null (il chiamante ignora il segnale LM).
 *
 * Espone globalmente `PinynSentenceNet`.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PinynSentenceNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const THRESHOLD = 7.5; // media -log P sopra la quale la frase è "insolita" (conservativo)
  const MIN_WORDS = 5;   // sotto: troppa varianza, si affidano alle regole

  let cachePromise = null;

  function defaultUrl() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('data/sentence-net.json');
    }
    return null;
  }

  function dequantize(v, s, perRow, d) {
    const n = v.length;
    const out = new Float32Array(n);
    if (perRow) {
      for (let r = 0; r < s.length; r++) {
        const sc = s[r];
        const base = r * d;
        for (let j = 0; j < d; j++) out[base + j] = v[base + j] * sc;
      }
    } else {
      for (let i = 0; i < n; i++) out[i] = v[i] * s;
    }
    return out;
  }

  /** @returns {Promise<object|null>} modello dequantizzato o null */
  function loadSentenceNet(url) {
    url = url || defaultUrl();
    if (!url) return Promise.resolve(null);
    if (cachePromise) return cachePromise;
    cachePromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((m) => build(m))
      .catch(() => null);
    return cachePromise;
  }

  function build(m) {
    return {
      K: m.K,
      V: m.V,
      d: m.d,
      H1: m.h1,
      vocab: m.vocab,
      vocabIndex: (function () {
        const map = new Map();
        m.vocab.forEach((s, i) => map.set(s, i));
        return map;
      })(),
      E: dequantize(m.E.v, m.E.s, true, m.d),
      W1: dequantize(m.W1.v, m.W1.s, false, 0),
      W2: dequantize(m.W2.v, m.W2.s, true, m.V),
      b1: Float32Array.from(m.b1),
      b2: Float32Array.from(m.b2),
    };
  }

  /** logits del target dato il contesto (indice di partenza nel campo idx). */
  function forwardLogits(model, idx, start) {
    const K = model.K, d = model.d, H1 = model.H1, V = model.V;
    const x = new Float32Array(K * d);
    for (let i = 0; i < K; i++) {
      const row = idx[start + i] * d;
      for (let j = 0; j < d; j++) x[i * d + j] = model.E[row + j];
    }
    const h1 = new Float32Array(H1);
    for (let j = 0; j < H1; j++) {
      let s = model.b1[j];
      for (let k = 0; k < K * d; k++) s += x[k] * model.W1[k * H1 + j];
      h1[j] = s > 0 ? s : 0;
    }
    const logits = new Float32Array(V);
    for (let j = 0; j < H1; j++) {
      const row = j * V;
      const h = h1[j];
      if (h === 0) continue;
      for (let k = 0; k < V; k++) logits[k] += h * model.W2[row + k];
    }
    for (let k = 0; k < V; k++) logits[k] += model.b2[k];
    return logits;
  }

  /**
   * Punteggio di una frase (parole pinyin BARE).
   * @param {object} model
   * @param {string[]} words
   * @returns {{avgNegLog:number, perplexity:number, flagged:boolean}|null}
   */
  function scoreSentence(model, words) {
    if (!model || !words || words.length <= model.K) return null;
    const K = model.K, V = model.V;
    const idx = new Int32Array(words.length);
    for (let i = 0; i < words.length; i++) {
      const v = model.vocabIndex.get(words[i]);
      idx[i] = v == null ? 1 : v; // 1 = <unk>
    }
    let sum = 0;
    let n = 0;
    for (let t = K; t < words.length; t++) {
      const logits = forwardLogits(model, idx, t - K);
      let max = -Infinity;
      for (let j = 0; j < V; j++) if (logits[j] > max) max = logits[j];
      let den = 0;
      for (let j = 0; j < V; j++) den += Math.exp(logits[j] - max);
      const p = Math.exp(logits[idx[t]] - max) / den;
      sum += -Math.log(Math.max(p, 1e-12));
      n++;
    }
    const avg = sum / n;
    return { avgNegLog: avg, perplexity: Math.exp(avg), flagged: avg > THRESHOLD };
  }

  return { loadSentenceNet, scoreSentence, forwardLogits, build, THRESHOLD, MIN_WORDS };
});
